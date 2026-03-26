// AsyncLocalStorage-based context propagation.
// This is the DX differentiator — developers call audit.record() anywhere in their
// request handling code and the actor/tenant are automatically available without
// being passed through every function call.

import { AsyncLocalStorage } from 'node:async_hooks';
import type { Actor } from './event.js';

/** The context stored in AsyncLocalStorage for each request. */
export interface AuditContext {
  actor: Actor;
  tenantId: string;
  metadata: Record<string, unknown>;
}

/** Configuration for the context middleware. */
export interface ContextConfig {
  /** Extract the actor from the incoming request. */
  actor: (req: unknown) => Actor;
  /** Extract the tenant ID from the incoming request. */
  tenant: (req: unknown) => string;
  /** Optional: extract additional request metadata (IP, user agent, request ID). */
  metadata?: ((req: unknown) => Record<string, unknown>) | undefined;
}

const store = new AsyncLocalStorage<AuditContext>();

/**
 * Returns the current audit context from AsyncLocalStorage, or undefined
 * if called outside a middleware-wrapped request.
 */
export function getContext(): AuditContext | undefined {
  return store.getStore();
}

/**
 * Creates framework-agnostic middleware that extracts actor, tenant, and metadata
 * from each incoming request and stores them in AsyncLocalStorage.
 *
 * Works with Express, Koa (via koa-connect), and Fastify (via middie).
 * The middleware signature `(req, res, next)` is the universal interop format.
 *
 * @example
 * ```ts
 * app.use(createMiddleware({
 *   actor: (req) => ({ id: req.user.id, type: 'user' }),
 *   tenant: (req) => req.user.orgId,
 * }));
 * ```
 */
export function createMiddleware(
  config: ContextConfig,
): (req: unknown, res: unknown, next: () => void) => void {
  return (req: unknown, _res: unknown, next: () => void) => {
    const context: AuditContext = {
      actor: config.actor(req),
      tenantId: config.tenant(req),
      metadata: config.metadata ? config.metadata(req) : {},
    };
    store.run(context, next);
  };
}

/**
 * Runs a function within a specific audit context. Useful for background jobs,
 * queue consumers, or any code that runs outside of an HTTP request.
 *
 * @example
 * ```ts
 * await runWithContext(
 *   { actor: systemActor, tenantId: 'org_123', metadata: {} },
 *   async () => { await audit.record({ action: 'cron.cleanup', ... }); }
 * );
 * ```
 */
export function runWithContext<T>(context: AuditContext, fn: () => T): T {
  return store.run(context, fn);
}
