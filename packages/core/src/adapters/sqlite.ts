// SQLite storage adapter using better-sqlite3.
// Synchronous under the hood (better-sqlite3 is sync), wrapped in async interface.
// Requires `better-sqlite3` as a peer dependency.

import { computeHash, ZERO_HASH } from '../event.js';
import type { AuditEvent } from '../event.js';
import type { QueryFilters, StorageAdapter, VerificationResult, VerifyOptions } from './interface.js';

/** Configuration for the SQLite adapter. */
export interface SqliteAdapterConfig {
  /** Path to the SQLite database file. Use ":memory:" for an in-memory database. */
  path: string;
}

interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

interface SqliteStatement {
  run(...params: unknown[]): void;
  all(...params: unknown[]): Record<string, unknown>[];
}

const RETRY_DELAYS = [100, 500, 2000];

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectWithRetry(path: string): Promise<SqliteDatabase> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    try {
      // Dynamic import so the peer dependency is only loaded when this adapter is used
      const BetterSqlite3 = (await import('better-sqlite3')).default;
      const db = new BetterSqlite3(path) as unknown as SqliteDatabase;
      return db;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const delay = RETRY_DELAYS[attempt];
      if (delay !== undefined && attempt < RETRY_DELAYS.length - 1) {
        await sleep(delay);
      }
    }
  }

  throw new Error(`trailkit: Failed to connect to SQLite at "${path}" after ${RETRY_DELAYS.length} attempts: ${lastError?.message}`);
}

function initializeSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_events (
      rowid INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      timestamp TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      actor_name TEXT,
      resource_type TEXT NOT NULL,
      resource_id TEXT NOT NULL,
      resource_before TEXT,
      resource_after TEXT,
      action TEXT NOT NULL,
      tenant_id TEXT NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}',
      hash TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_id);
    CREATE INDEX IF NOT EXISTS idx_audit_resource_type ON audit_events(resource_type);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_events(action);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_events(timestamp);
  `);
}

function eventToRow(event: AuditEvent) {
  return {
    id: event.id,
    timestamp: event.timestamp,
    actor_id: event.actor.id,
    actor_type: event.actor.type,
    actor_name: event.actor.name ?? null,
    resource_type: event.resource.type,
    resource_id: event.resource.id,
    resource_before: event.resource.before ? JSON.stringify(event.resource.before) : null,
    resource_after: event.resource.after ? JSON.stringify(event.resource.after) : null,
    action: event.action,
    tenant_id: event.tenantId,
    metadata: JSON.stringify(event.metadata),
    hash: event.hash,
  };
}

function rowToEvent(row: Record<string, unknown>): AuditEvent {
  return {
    id: row['id'] as string,
    timestamp: row['timestamp'] as string,
    actor: {
      id: row['actor_id'] as string,
      type: row['actor_type'] as string,
      ...(row['actor_name'] ? { name: row['actor_name'] as string } : {}),
    },
    resource: {
      type: row['resource_type'] as string,
      id: row['resource_id'] as string,
      ...(row['resource_before'] ? { before: JSON.parse(row['resource_before'] as string) as Record<string, unknown> } : {}),
      ...(row['resource_after'] ? { after: JSON.parse(row['resource_after'] as string) as Record<string, unknown> } : {}),
    },
    action: row['action'] as string,
    tenantId: row['tenant_id'] as string,
    metadata: JSON.parse(row['metadata'] as string) as Record<string, unknown>,
    hash: row['hash'] as string,
  };
}

/**
 * Creates a SQLite storage adapter backed by better-sqlite3.
 * The database file is created automatically if it doesn't exist.
 * Retries connection up to 3 times with exponential backoff.
 *
 * Requires `better-sqlite3` as a peer dependency:
 * ```bash
 * pnpm add better-sqlite3
 * ```
 *
 * @example
 * ```ts
 * import { sqliteAdapter } from 'trailkit/adapters/sqlite';
 * const storage = sqliteAdapter({ path: './audit.db' });
 * ```
 */
export function sqliteAdapter(config: SqliteAdapterConfig): StorageAdapter {
  let dbPromise: Promise<SqliteDatabase> | null = null;

  function getDb(): Promise<SqliteDatabase> {
    if (!dbPromise) {
      dbPromise = connectWithRetry(config.path).then((db) => {
        initializeSchema(db);
        return db;
      });
    }
    return dbPromise;
  }

  return {
    async append(event: AuditEvent): Promise<void> {
      const db = await getDb();
      const row = eventToRow(event);
      db.prepare(`
        INSERT INTO audit_events (id, timestamp, actor_id, actor_type, actor_name, resource_type, resource_id, resource_before, resource_after, action, tenant_id, metadata, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        row.id, row.timestamp, row.actor_id, row.actor_type, row.actor_name,
        row.resource_type, row.resource_id, row.resource_before, row.resource_after,
        row.action, row.tenant_id, row.metadata, row.hash,
      );
    },

    async query(filters: QueryFilters): Promise<AuditEvent[]> {
      const db = await getDb();
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filters.tenantId !== undefined) {
        conditions.push('tenant_id = ?');
        params.push(filters.tenantId);
      }
      if (filters.actorId !== undefined) {
        conditions.push('actor_id = ?');
        params.push(filters.actorId);
      }
      if (filters.resourceType !== undefined) {
        conditions.push('resource_type = ?');
        params.push(filters.resourceType);
      }
      if (filters.resourceId !== undefined) {
        conditions.push('resource_id = ?');
        params.push(filters.resourceId);
      }
      if (filters.action !== undefined) {
        if (filters.action.includes('*')) {
          conditions.push('action LIKE ?');
          params.push(filters.action.replace(/\*/g, '%'));
        } else {
          conditions.push('action = ?');
          params.push(filters.action);
        }
      }
      if (filters.from !== undefined) {
        conditions.push('timestamp >= ?');
        params.push(filters.from.toISOString());
      }
      if (filters.to !== undefined) {
        conditions.push('timestamp <= ?');
        params.push(filters.to.toISOString());
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;

      const rows = db.prepare(
        `SELECT * FROM audit_events ${where} ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?`,
      ).all(...params, limit, offset);

      return rows.map(rowToEvent);
    },

    async verify(options: VerifyOptions): Promise<VerificationResult> {
      const db = await getDb();
      const where = options.tenantId ? 'WHERE tenant_id = ?' : '';
      const params = options.tenantId ? [options.tenantId] : [];

      const rows = db.prepare(
        `SELECT * FROM audit_events ${where} ORDER BY rowid ASC`,
      ).all(...params);

      let previousHash = ZERO_HASH;
      for (let i = 0; i < rows.length; i++) {
        const event = rowToEvent(rows[i]!);
        const expected = computeHash(event, previousHash);
        if (event.hash !== expected) {
          return { valid: false, eventsChecked: i + 1, tamperedEventId: event.id };
        }
        previousHash = event.hash;
      }

      return { valid: true, eventsChecked: rows.length, tamperedEventId: null };
    },

    async close(): Promise<void> {
      if (dbPromise) {
        const db = await dbPromise;
        db.close();
        dbPromise = null;
      }
    },
  };
}
