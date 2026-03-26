// The main audit object that ties together context, events, storage, and redaction.
// This is what developers interact with — it should feel like a natural TypeScript API.

import { EventEmitter } from 'node:events';
import type { Actor, AuditEvent, RecordInput, RedactConfig } from './event.js';
import { applyRedaction, buildEvent, ZERO_HASH } from './event.js';
import type { QueryFilters, StorageAdapter, VerificationResult, VerifyOptions } from './adapters/interface.js';
import { createMiddleware, getContext } from './context.js';
import type { ContextConfig } from './context.js';

/** Configuration for creating an audit log instance. */
export interface AuditLogConfig {
  /** The storage adapter to use for persisting events. */
  storage: StorageAdapter;
  /** Extract the actor from the incoming request. */
  actor: ContextConfig['actor'];
  /** Extract the tenant ID from the incoming request. */
  tenant: ContextConfig['tenant'];
  /** Optional: extract additional request metadata from the request. */
  metadata?: ContextConfig['metadata'] | undefined;
  /** Optional: PII redaction rules applied before storage. */
  redact?: RedactConfig | undefined;
}

/** The audit log instance returned by `createAuditLog`. */
export interface AuditLog {
  /**
   * Returns middleware that extracts actor and tenant from each request.
   * Use with Express, Fastify (middie), or Koa (koa-connect).
   *
   * @example
   * ```ts
   * app.use(audit.middleware());
   * ```
   */
  middleware(): (req: unknown, res: unknown, next: () => void) => void;

  /**
   * Records an audit event. Actor and tenant are read from the current request
   * context automatically. If called outside a request, actor and tenantId must
   * be provided in the input.
   *
   * This method is fire-and-forget safe — it never throws. If the storage adapter
   * fails, the error is emitted as an 'error' event on the audit instance.
   *
   * @example
   * ```ts
   * await audit.record({
   *   action: 'invoice.payment.initiated',
   *   resource: { type: 'invoice', id: 'inv_123' },
   *   metadata: { amount: 100, currency: 'USD' },
   * });
   * ```
   */
  record(input: RecordInput): Promise<void>;

  /**
   * Queries stored audit events with optional filters.
   *
   * @example
   * ```ts
   * const events = await audit.query({
   *   tenantId: 'org_123',
   *   action: 'invoice.payment.*',
   *   limit: 25,
   * });
   * ```
   */
  query(filters: QueryFilters): Promise<AuditEvent[]>;

  /**
   * Verifies the integrity of the audit event hash chain.
   * Returns which event was tampered with, if any.
   *
   * @example
   * ```ts
   * const result = await audit.verify({ tenantId: 'org_123' });
   * if (!result.valid) console.error(`Tampered: ${result.tamperedEventId}`);
   * ```
   */
  verify(options?: VerifyOptions): Promise<VerificationResult>;

  /** Subscribe to audit log lifecycle events (currently: 'error'). */
  on(event: 'error', listener: (error: Error) => void): void;

  /** Release resources held by the storage adapter. */
  close(): Promise<void>;
}

/**
 * Creates a new audit log instance.
 *
 * This is the main entry point for trailkit. It wires together context propagation,
 * event building, PII redaction, and the storage adapter into a single, cohesive API.
 *
 * @example
 * ```ts
 * import { createAuditLog } from 'trailkit';
 * import { sqliteAdapter } from 'trailkit/adapters/sqlite';
 *
 * const audit = createAuditLog({
 *   storage: sqliteAdapter({ path: './audit.db' }),
 *   actor: (req) => ({ id: req.user.id, type: 'user', name: req.user.email }),
 *   tenant: (req) => req.user.organizationId,
 * });
 * ```
 */
export function createAuditLog(config: AuditLogConfig): AuditLog {
  const emitter = new EventEmitter();
  let lastHash = ZERO_HASH;

  const mw = createMiddleware({
    actor: config.actor,
    tenant: config.tenant,
    metadata: config.metadata,
  });

  return {
    middleware() {
      return mw;
    },

    async record(input: RecordInput): Promise<void> {
      try {
        const ctx = getContext();

        const actor = input.actor ?? ctx?.actor;
        const tenantId = input.tenantId ?? ctx?.tenantId;

        if (!actor) {
          throw new Error(
            'trailkit: No actor available. Either call audit.record() inside a request ' +
            'wrapped by audit.middleware(), or pass actor explicitly in the input.',
          );
        }
        if (!tenantId) {
          throw new Error(
            'trailkit: No tenantId available. Either call audit.record() inside a request ' +
            'wrapped by audit.middleware(), or pass tenantId explicitly in the input.',
          );
        }

        // Merge request metadata from context with event metadata
        const metadata = { ...ctx?.metadata, ...input.metadata };

        let event = buildEvent({ ...input, metadata }, actor, tenantId, lastHash);

        if (config.redact) {
          event = applyRedaction(event, config.redact);
        }

        await config.storage.append(event);
        lastHash = event.hash;
      } catch (err) {
        emitter.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    },

    async query(filters: QueryFilters): Promise<AuditEvent[]> {
      return config.storage.query(filters);
    },

    async verify(options: VerifyOptions = {}): Promise<VerificationResult> {
      return config.storage.verify(options);
    },

    on(event: 'error', listener: (error: Error) => void) {
      emitter.on(event, listener);
    },

    async close(): Promise<void> {
      await config.storage.close();
    },
  };
}
