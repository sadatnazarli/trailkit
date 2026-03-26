// Public API surface for trailkit.
// Only re-exports — no logic lives here.

export { createAuditLog } from './audit.js';
export type { AuditLog, AuditLogConfig } from './audit.js';

export type { AuditEvent, Actor, Resource, RecordInput, RedactConfig, RedactStrategy } from './event.js';

export type {
  StorageAdapter,
  QueryFilters,
  VerifyOptions,
  VerificationResult,
} from './adapters/interface.js';

export { getContext, runWithContext } from './context.js';
export type { AuditContext, ContextConfig } from './context.js';
