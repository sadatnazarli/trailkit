// Event schema, ID generation, hash computation, and PII redaction.
// This is the heart of trailkit — every audit event flows through these types and functions.

import { createHash, randomBytes } from 'node:crypto';

/** The actor who performed an auditable action. */
export interface Actor {
  /** Unique identifier for the actor (e.g. user ID, API key ID). */
  id: string;
  /** What kind of actor this is (e.g. "user", "system", "api_key"). */
  type: string;
  /** Human-readable name, useful for display but not relied on for identity. */
  name?: string | undefined;
}

/** The resource that was acted upon. */
export interface Resource {
  /** Resource type in your domain model (e.g. "invoice", "user", "project"). */
  type: string;
  /** Unique identifier for this specific resource instance. */
  id: string;
  /** State of the resource before the action, for update events. */
  before?: Record<string, unknown> | undefined;
  /** State of the resource after the action, for update events. */
  after?: Record<string, unknown> | undefined;
}

/** A complete, immutable audit event as stored by an adapter. */
export interface AuditEvent {
  /** Unique event ID, URL-safe. */
  id: string;
  /** ISO 8601 timestamp with millisecond precision. */
  timestamp: string;
  /** Who performed the action. */
  actor: Actor;
  /** What was acted upon. */
  resource: Resource;
  /** Dot-notation action string (e.g. "invoice.payment.initiated"). */
  action: string;
  /** Tenant ID for multi-tenant isolation. */
  tenantId: string;
  /** Arbitrary structured metadata. */
  metadata: Record<string, unknown>;
  /** SHA-256 integrity hash, chained to the previous event. */
  hash: string;
}

/** What the developer passes to `audit.record()` — actor and tenant come from context. */
export interface RecordInput {
  /** Dot-notation action string (e.g. "user.creditLimit.updated"). */
  action: string;
  /** The resource being acted upon. */
  resource: Resource;
  /** Optional metadata to attach to the event. */
  metadata?: Record<string, unknown> | undefined;
  /** Override the actor from context. Useful for system-initiated actions. */
  actor?: Actor | undefined;
  /** Override the tenant from context. */
  tenantId?: string | undefined;
}

/** Redaction strategy for a field path. */
export type RedactStrategy = 'mask' | 'remove' | 'hash';

/** Map of dot-notation field paths to redaction strategies. */
export type RedactConfig = Record<string, RedactStrategy>;

// Base64url alphabet, matching nanoid's URL-safe output
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * Generates a 21-character URL-safe unique ID using crypto.randomBytes.
 * Equivalent to nanoid but with zero dependencies.
 *
 * @example
 * ```ts
 * const id = generateId(); // "V1StGXR8_Z5jdHi6B-myT"
 * ```
 */
export function generateId(): string {
  const bytes = randomBytes(21);
  let id = '';
  for (let i = 0; i < 21; i++) {
    id += URL_SAFE[bytes[i]! & 63];
  }
  return id;
}

/**
 * Produces a deterministic JSON string with keys sorted alphabetically at every depth.
 * This ensures identical objects always produce identical hashes regardless of property insertion order.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || obj === undefined) return JSON.stringify(obj);
  if (typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) {
    return '[' + obj.map((item) => canonicalJson(item)).join(',') + ']';
  }
  const sorted = Object.keys(obj as Record<string, unknown>)
    .sort()
    .map((key) => {
      const val = (obj as Record<string, unknown>)[key];
      return JSON.stringify(key) + ':' + canonicalJson(val);
    });
  return '{' + sorted.join(',') + '}';
}

/** The well-known zero hash used as the previousHash for the first event in a chain. */
export const ZERO_HASH = '0'.repeat(64);

/**
 * Computes the SHA-256 integrity hash for an audit event.
 * The hash covers the event's identity fields and chains to the previous event's hash,
 * making the entire event log tamper-evident.
 *
 * @example
 * ```ts
 * const hash = computeHash(event, previousHash);
 * ```
 */
export function computeHash(
  event: Pick<AuditEvent, 'id' | 'timestamp' | 'actor' | 'tenantId' | 'action' | 'resource'>,
  previousHash: string,
): string {
  const payload = canonicalJson({
    id: event.id,
    timestamp: event.timestamp,
    actorId: event.actor.id,
    tenantId: event.tenantId,
    action: event.action,
    resourceType: event.resource.type,
    resourceId: event.resource.id,
    previousHash,
  });
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Builds a complete AuditEvent from a RecordInput and context values.
 * Generates the ID, timestamp, and computes the integrity hash.
 */
export function buildEvent(
  input: RecordInput,
  actor: Actor,
  tenantId: string,
  previousHash: string,
): AuditEvent {
  const event: Omit<AuditEvent, 'hash'> = {
    id: generateId(),
    timestamp: new Date().toISOString(),
    actor: input.actor ?? actor,
    resource: input.resource,
    action: input.action,
    tenantId: input.tenantId ?? tenantId,
    metadata: input.metadata ?? {},
  };

  return {
    ...event,
    hash: computeHash(event, previousHash),
  };
}

/**
 * Gets a nested value from an object using a dot-notation path.
 * Returns undefined if any segment is missing.
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Sets a nested value on an object using a dot-notation path.
 * Creates intermediate objects as needed.
 */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current[part] === undefined || typeof current[part] !== 'object') {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const lastPart = parts[parts.length - 1]!;
  current[lastPart] = value;
}

/**
 * Deletes a nested value from an object using a dot-notation path.
 */
function deleteNestedValue(obj: Record<string, unknown>, path: string): void {
  const parts = path.split('.');
  let current: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    if (current === null || current === undefined || typeof current !== 'object') return;
    current = (current as Record<string, unknown>)[part];
  }
  if (current !== null && current !== undefined && typeof current === 'object') {
    delete (current as Record<string, unknown>)[parts[parts.length - 1]!];
  }
}

/**
 * Masks a string value, keeping only the last 4 characters visible.
 * Short strings (4 or fewer chars) are fully masked.
 */
function maskValue(value: unknown): string {
  const str = String(value);
  if (str.length <= 4) return '****';
  return '*'.repeat(str.length - 4) + str.slice(-4);
}

/** Hashes a value with SHA-256 for irreversible redaction. */
function hashValue(value: unknown): string {
  return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Applies PII redaction rules to an audit event before storage.
 * Returns a new event — the original is not mutated.
 *
 * Strategies:
 * - `mask`: replaces all but the last 4 characters with asterisks
 * - `remove`: deletes the field entirely
 * - `hash`: replaces the value with its SHA-256 hash
 *
 * @example
 * ```ts
 * const redacted = applyRedaction(event, {
 *   'metadata.cardNumber': 'mask',
 *   'actor.name': 'hash',
 * });
 * ```
 */
export function applyRedaction(event: AuditEvent, config: RedactConfig): AuditEvent {
  // Deep clone to avoid mutating the original
  const redacted = JSON.parse(JSON.stringify(event)) as AuditEvent;

  for (const [path, strategy] of Object.entries(config)) {
    const value = getNestedValue(redacted as unknown as Record<string, unknown>, path);
    if (value === undefined) continue;

    switch (strategy) {
      case 'mask':
        setNestedValue(redacted as unknown as Record<string, unknown>, path, maskValue(value));
        break;
      case 'remove':
        deleteNestedValue(redacted as unknown as Record<string, unknown>, path);
        break;
      case 'hash':
        setNestedValue(redacted as unknown as Record<string, unknown>, path, hashValue(value));
        break;
    }
  }

  return redacted;
}
