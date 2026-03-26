// The contract that every storage adapter must fulfill.
// Keeping this interface minimal ensures adapters are easy to implement and test.

import type { AuditEvent } from '../event.js';

/** Filters for querying audit events. All fields are optional — omitted fields are not filtered. */
export interface QueryFilters {
  /** Filter events to a specific tenant. */
  tenantId?: string | undefined;
  /** Filter events by the actor who performed the action. */
  actorId?: string | undefined;
  /** Filter by action string. Supports trailing wildcard (e.g. "invoice.payment.*"). */
  action?: string | undefined;
  /** Filter by resource type. */
  resourceType?: string | undefined;
  /** Filter by resource ID. */
  resourceId?: string | undefined;
  /** Only return events on or after this date. */
  from?: Date | undefined;
  /** Only return events on or before this date. */
  to?: Date | undefined;
  /** Maximum number of events to return. Defaults to 50. */
  limit?: number | undefined;
  /** Number of events to skip for pagination. Defaults to 0. */
  offset?: number | undefined;
}

/** Options for verifying the integrity of the audit event chain. */
export interface VerifyOptions {
  /** Verify events for a specific tenant. If omitted, verifies all events. */
  tenantId?: string | undefined;
}

/** The result of an integrity verification. */
export interface VerificationResult {
  /** Whether all events in the chain have valid hashes. */
  valid: boolean;
  /** Total number of events that were checked. */
  eventsChecked: number;
  /** The ID of the first event with an invalid hash, or null if all are valid. */
  tamperedEventId: string | null;
}

/**
 * The interface every trailkit storage adapter must implement.
 *
 * Adapters are responsible for persisting audit events, querying them,
 * and verifying the integrity of the hash chain. The interface is deliberately
 * small — four methods — so that writing a custom adapter is straightforward.
 */
export interface StorageAdapter {
  /** Persist a single audit event. Must preserve insertion order for hash chain verification. */
  append(event: AuditEvent): Promise<void>;

  /** Query stored events with optional filters. Returns events in reverse chronological order. */
  query(filters: QueryFilters): Promise<AuditEvent[]>;

  /** Verify the integrity of the hash chain. */
  verify(options: VerifyOptions): Promise<VerificationResult>;

  /** Release any resources held by the adapter (database connections, file handles). */
  close(): Promise<void>;
}
