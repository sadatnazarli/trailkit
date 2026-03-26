// PostgreSQL storage adapter using the pg package.
// Async-native — fits the StorageAdapter interface naturally.
// Requires `pg` as a peer dependency.

import { computeHash, ZERO_HASH } from '../event.js';
import type { AuditEvent } from '../event.js';
import type { QueryFilters, StorageAdapter, VerificationResult, VerifyOptions } from './interface.js';

/** Configuration for the PostgreSQL adapter. */
export interface PostgresAdapterConfig {
  /** PostgreSQL connection string (e.g. "postgresql://user:pass@localhost/mydb"). */
  connectionString: string;
  /** Table name for audit events. Defaults to "audit_events". */
  tableName?: string | undefined;
}

interface PgPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

const RETRY_DELAYS = [100, 500, 2000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(connectionString: string): Promise<PgPool> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      const pg = await import('pg');
      const Pool = pg.default?.Pool ?? pg.Pool;
      const pool = new Pool({ connectionString }) as unknown as PgPool;
      // Verify connection
      await pool.query('SELECT 1');
      return pool;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const delay = RETRY_DELAYS[attempt];
      if (delay !== undefined && attempt < RETRY_DELAYS.length - 1) {
        await sleep(delay);
      }
    }
  }

  throw new Error(`trailkit: Failed to connect to PostgreSQL after ${RETRY_DELAYS.length} attempts: ${lastError?.message}`);
}

async function initializeSchema(pool: PgPool, tableName: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${tableName} (
      seq BIGSERIAL PRIMARY KEY,
      id TEXT UNIQUE NOT NULL,
      timestamp TIMESTAMPTZ NOT NULL,
      actor_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_name TEXT,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_before JSONB,
      resource_after JSONB,
      action TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}',
      hash TEXT NOT NULL
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_tenant ON ${tableName}(tenant_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_actor ON ${tableName}(actor_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_resource_type ON ${tableName}(resource_type)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_action ON ${tableName}(action)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_${tableName}_timestamp ON ${tableName}(timestamp)`);
}

function rowToEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: row['id'] as string,
    timestamp: (row['timestamp'] as Date).toISOString(),
    actor: {
      id: row['actor_id'] as string,
      type: row['actor_type'] as string,
      ...(row['actor_name'] ? { name: row['actor_name'] as string } : {}),
    },
    resource: {
      type: row['resource_type'] as string,
      id: row['resource_id'] as string,
      ...(row['resource_before'] ? { before: row['resource_before'] as Record<string, unknown> } : {}),
      ...(row['resource_after'] ? { after: row['resource_after'] as Record<string, unknown> } : {}),
    },
    action: row['action'] as string,
    tenantId: row['tenant_id'] as string,
    metadata: (row['metadata'] ?? {}) as Record<string, unknown>,
    hash: row['hash'] as string,
  };
}

/**
 * Creates a PostgreSQL storage adapter backed by the pg package.
 * The table is created automatically if it doesn't exist.
 * Retries connection up to 3 times with exponential backoff.
 *
 * Requires `pg` as a peer dependency:
 * ```bash
 * pnpm add pg
 * ```
 *
 * @example
 * ```ts
 * import { postgresAdapter } from 'trailkit/adapters/postgres';
 * const storage = postgresAdapter({
 *   connectionString: 'postgresql://localhost/myapp',
 * });
 * ```
 */
export function postgresAdapter(config: PostgresAdapterConfig): StorageAdapter {
  const tableName = config.tableName ?? 'audit_events';
  let poolPromise: Promise<PgPool> | null = null;

  function getPool(): Promise<PgPool> {
    if (!poolPromise) {
      poolPromise = connectWithRetry(config.connectionString).then(async (pool) => {
        await initializeSchema(pool, tableName);
        return pool;
      });
    }
    return poolPromise;
  }

  return {
    async append(event: AuditEvent): Promise<void> {
      const pool = await getPool();
      await pool.query(
        `INSERT INTO ${tableName} (id, timestamp, actor_id, actor_type, actor_name, resource_type, resource_id, resource_before, resource_after, action, tenant_id, metadata, hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          event.id,
          event.timestamp,
          event.actor.id,
          event.actor.type,
          event.actor.name ?? null,
          event.resource.type,
          event.resource.id,
          event.resource.before ? JSON.stringify(event.resource.before) : null,
          event.resource.after ? JSON.stringify(event.resource.after) : null,
          event.action,
          event.tenantId,
          JSON.stringify(event.metadata),
          event.hash,
        ],
      );
    },

    async query(filters: QueryFilters): Promise<AuditEvent[]> {
      const pool = await getPool();
      const conditions: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (filters.tenantId !== undefined) {
        conditions.push(`tenant_id = $${paramIndex++}`);
        params.push(filters.tenantId);
      }
      if (filters.actorId !== undefined) {
        conditions.push(`actor_id = $${paramIndex++}`);
        params.push(filters.actorId);
      }
      if (filters.resourceType !== undefined) {
        conditions.push(`resource_type = $${paramIndex++}`);
        params.push(filters.resourceType);
      }
      if (filters.resourceId !== undefined) {
        conditions.push(`resource_id = $${paramIndex++}`);
        params.push(filters.resourceId);
      }
      if (filters.action !== undefined) {
        if (filters.action.includes('*')) {
          conditions.push(`action LIKE $${paramIndex++}`);
          params.push(filters.action.replace(/\*/g, '%'));
        } else {
          conditions.push(`action = $${paramIndex++}`);
          params.push(filters.action);
        }
      }
      if (filters.from !== undefined) {
        conditions.push(`timestamp >= $${paramIndex++}`);
        params.push(filters.from.toISOString());
      }
      if (filters.to !== undefined) {
        conditions.push(`timestamp <= $${paramIndex++}`);
        params.push(filters.to.toISOString());
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;

      const result = await pool.query(
        `SELECT * FROM ${tableName} ${where} ORDER BY timestamp DESC, seq DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...params, limit, offset],
      );

      return result.rows.map(rowToEvent);
    },

    async verify(options: VerifyOptions): Promise<VerificationResult> {
      const pool = await getPool();
      const where = options.tenantId ? 'WHERE tenant_id = $1' : '';
      const params = options.tenantId ? [options.tenantId] : [];

      const result = await pool.query(
        `SELECT * FROM ${tableName} ${where} ORDER BY seq ASC`,
        params,
      );

      let previousHash = ZERO_HASH;
      for (let i = 0; i < result.rows.length; i++) {
        const event = rowToEvent(result.rows[i]!);
        const expected = computeHash(event, previousHash);
        if (event.hash !== expected) {
          return { valid: false, eventsChecked: i + 1, tamperedEventId: event.id };
        }
        previousHash = event.hash;
      }

      return { valid: true, eventsChecked: result.rows.length, tamperedEventId: null };
    },

    async close(): Promise<void> {
      if (poolPromise) {
        const pool = await poolPromise;
        await pool.end();
        poolPromise = null;
      }
    },
  };
}
