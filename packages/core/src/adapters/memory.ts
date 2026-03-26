// In-memory storage adapter — ideal for testing and development.
// Events are stored in a plain array. No persistence, no dependencies.

import { computeHash, ZERO_HASH } from '../event.js';
import type { AuditEvent } from '../event.js';
import type { QueryFilters, StorageAdapter, VerificationResult, VerifyOptions } from './interface.js';

/**
 * Converts a dot-notation action filter (with optional trailing wildcard) to a RegExp.
 * "invoice.payment.*" becomes /^invoice\.payment\..+$/
 * "invoice.payment.initiated" becomes an exact match.
 */
function actionToRegex(pattern: string): RegExp {
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${prefix}\\..+$`);
  }
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  }
  return new RegExp(`^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
}

function matchesFilters(event: AuditEvent, filters: QueryFilters): boolean {
  if (filters.tenantId !== undefined && event.tenantId !== filters.tenantId) return false;
  if (filters.actorId !== undefined && event.actor.id !== filters.actorId) return false;
  if (filters.resourceType !== undefined && event.resource.type !== filters.resourceType)
    return false;
  if (filters.resourceId !== undefined && event.resource.id !== filters.resourceId) return false;
  if (filters.action !== undefined && !actionToRegex(filters.action).test(event.action))
    return false;
  if (filters.from !== undefined && new Date(event.timestamp) < filters.from) return false;
  if (filters.to !== undefined && new Date(event.timestamp) > filters.to) return false;
  return true;
}

/**
 * Creates an in-memory storage adapter. Events are held in an array and lost when
 * the process exits. Perfect for unit tests and local development.
 *
 * @example
 * ```ts
 * import { memoryAdapter } from 'trailkit/adapters/memory';
 * const storage = memoryAdapter();
 * ```
 */
export function memoryAdapter(): StorageAdapter {
  const events: AuditEvent[] = [];

  return {
    async append(event: AuditEvent): Promise<void> {
      events.push(event);
    },

    async query(filters: QueryFilters): Promise<AuditEvent[]> {
      const limit = filters.limit ?? 50;
      const offset = filters.offset ?? 0;

      const matched = events.filter((e) => matchesFilters(e, filters));
      // Reverse chronological order
      matched.reverse();
      return matched.slice(offset, offset + limit);
    },

    async verify(options: VerifyOptions): Promise<VerificationResult> {
      const chain = options.tenantId
        ? events.filter((e) => e.tenantId === options.tenantId)
        : [...events];

      let previousHash = ZERO_HASH;
      for (const event of chain) {
        const expected = computeHash(event, previousHash);
        if (event.hash !== expected) {
          return { valid: false, eventsChecked: chain.indexOf(event) + 1, tamperedEventId: event.id };
        }
        previousHash = event.hash;
      }

      return { valid: true, eventsChecked: chain.length, tamperedEventId: null };
    },

    async close(): Promise<void> {
      events.length = 0;
    },
  };
}
