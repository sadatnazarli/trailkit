import { describe, it, expect, beforeEach } from 'vitest';
import { memoryAdapter } from '../adapters/memory.js';
import { buildEvent, ZERO_HASH } from '../event.js';
import type { StorageAdapter } from '../adapters/interface.js';
import type { AuditEvent } from '../event.js';

const actor = { id: 'user_1', type: 'user', name: 'Alice' };
const tenantId = 'org_1';

function makeEvent(
  action: string,
  resourceType: string,
  previousHash: string,
  overrides: { tenantId?: string; actorId?: string } = {},
): AuditEvent {
  return buildEvent(
    {
      action,
      resource: { type: resourceType, id: `${resourceType}_1` },
      ...(overrides.actorId ? { actor: { id: overrides.actorId, type: 'user' } } : {}),
      ...(overrides.tenantId ? { tenantId: overrides.tenantId } : {}),
    },
    actor,
    overrides.tenantId ?? tenantId,
    previousHash,
  );
}

describe('memoryAdapter', () => {
  let adapter: StorageAdapter;

  beforeEach(() => {
    adapter = memoryAdapter();
  });

  it('appends and retrieves a single event', async () => {
    const event = makeEvent('user.created', 'user', ZERO_HASH);
    await adapter.append(event);

    const results = await adapter.query({ tenantId });
    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe('user.created');
  });

  it('returns events in reverse chronological order', async () => {
    const e1 = makeEvent('a.first', 'doc', ZERO_HASH);
    const e2 = makeEvent('b.second', 'doc', e1.hash);
    await adapter.append(e1);
    await adapter.append(e2);

    const results = await adapter.query({});
    expect(results[0]!.action).toBe('b.second');
    expect(results[1]!.action).toBe('a.first');
  });

  it('filters by tenantId', async () => {
    const e1 = makeEvent('test.action', 'doc', ZERO_HASH);
    const e2 = makeEvent('test.action', 'doc', e1.hash, { tenantId: 'org_2' });
    await adapter.append(e1);
    await adapter.append(e2);

    const results = await adapter.query({ tenantId: 'org_2' });
    expect(results).toHaveLength(1);
    expect(results[0]!.tenantId).toBe('org_2');
  });

  it('filters by actorId', async () => {
    const e1 = makeEvent('test.action', 'doc', ZERO_HASH);
    const e2 = makeEvent('test.action', 'doc', e1.hash, { actorId: 'user_2' });
    await adapter.append(e1);
    await adapter.append(e2);

    const results = await adapter.query({ actorId: 'user_2' });
    expect(results).toHaveLength(1);
    expect(results[0]!.actor.id).toBe('user_2');
  });

  it('filters by exact action', async () => {
    const e1 = makeEvent('invoice.created', 'invoice', ZERO_HASH);
    const e2 = makeEvent('invoice.deleted', 'invoice', e1.hash);
    await adapter.append(e1);
    await adapter.append(e2);

    const results = await adapter.query({ action: 'invoice.created' });
    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe('invoice.created');
  });

  it('filters by action with trailing wildcard', async () => {
    const e1 = makeEvent('invoice.payment.initiated', 'invoice', ZERO_HASH);
    const e2 = makeEvent('invoice.payment.completed', 'invoice', e1.hash);
    const e3 = makeEvent('user.updated', 'user', e2.hash);
    await adapter.append(e1);
    await adapter.append(e2);
    await adapter.append(e3);

    const results = await adapter.query({ action: 'invoice.payment.*' });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.action.startsWith('invoice.payment.'))).toBe(true);
  });

  it('respects limit and offset for pagination', async () => {
    const events: AuditEvent[] = [];
    let prevHash = ZERO_HASH;
    for (let i = 0; i < 10; i++) {
      const e = makeEvent(`action.${i}`, 'doc', prevHash);
      events.push(e);
      await adapter.append(e);
      prevHash = e.hash;
    }

    const page1 = await adapter.query({ limit: 3, offset: 0 });
    expect(page1).toHaveLength(3);

    const page2 = await adapter.query({ limit: 3, offset: 3 });
    expect(page2).toHaveLength(3);
    expect(page2[0]!.id).not.toBe(page1[0]!.id);
  });

  it('filters by date range', async () => {
    const e1 = makeEvent('old.action', 'doc', ZERO_HASH);
    // Manually override timestamp for testing
    const earlyEvent = { ...e1, timestamp: '2024-01-01T00:00:00.000Z' };
    const e2 = makeEvent('new.action', 'doc', e1.hash);

    await adapter.append(earlyEvent);
    await adapter.append(e2);

    const results = await adapter.query({ from: new Date('2025-01-01') });
    expect(results).toHaveLength(1);
    expect(results[0]!.action).toBe('new.action');
  });
});

describe('memoryAdapter verification', () => {
  it('verifies an intact hash chain', async () => {
    const adapter = memoryAdapter();
    const e1 = makeEvent('first', 'doc', ZERO_HASH);
    const e2 = makeEvent('second', 'doc', e1.hash);
    await adapter.append(e1);
    await adapter.append(e2);

    const result = await adapter.verify({});
    expect(result.valid).toBe(true);
    expect(result.eventsChecked).toBe(2);
    expect(result.tamperedEventId).toBeNull();
  });

  it('detects a tampered event', async () => {
    const adapter = memoryAdapter();
    const e1 = makeEvent('first', 'doc', ZERO_HASH);
    const e2 = makeEvent('second', 'doc', e1.hash);

    // Tamper with the first event's action after hash was computed
    const tampered = { ...e1, action: 'tampered.action' };
    await adapter.append(tampered);
    await adapter.append(e2);

    const result = await adapter.verify({});
    expect(result.valid).toBe(false);
    expect(result.tamperedEventId).toBe(tampered.id);
  });

  it('verifies events scoped to a specific tenant', async () => {
    const adapter = memoryAdapter();
    const e1 = makeEvent('org1.action', 'doc', ZERO_HASH);
    const e2 = makeEvent('org2.action', 'doc', e1.hash, { tenantId: 'org_2' });
    await adapter.append(e1);
    await adapter.append(e2);

    // Verify only org_1 — should pass (only 1 event in that tenant's chain)
    const result = await adapter.verify({ tenantId: 'org_1' });
    expect(result.valid).toBe(true);
    expect(result.eventsChecked).toBe(1);
  });

  it('returns valid for an empty store', async () => {
    const adapter = memoryAdapter();
    const result = await adapter.verify({});
    expect(result.valid).toBe(true);
    expect(result.eventsChecked).toBe(0);
  });
});
