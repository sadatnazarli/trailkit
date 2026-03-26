import { describe, it, expect } from 'vitest';
import {
  generateId,
  canonicalJson,
  computeHash,
  buildEvent,
  applyRedaction,
  ZERO_HASH,
} from '../event.js';
import type { AuditEvent, RecordInput } from '../event.js';

describe('generateId', () => {
  it('produces a 21-character string', () => {
    const id = generateId();
    expect(id).toHaveLength(21);
  });

  it('produces URL-safe characters only', () => {
    for (let i = 0; i < 100; i++) {
      const id = generateId();
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('produces unique IDs', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => generateId()));
    expect(ids.size).toBe(1000);
  });
});

describe('canonicalJson', () => {
  it('sorts object keys alphabetically', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('sorts nested object keys', () => {
    expect(canonicalJson({ z: { b: 1, a: 2 }, a: 1 })).toBe('{"a":1,"z":{"a":2,"b":1}}');
  });

  it('handles arrays without reordering', () => {
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });

  it('handles primitives', () => {
    expect(canonicalJson('hello')).toBe('"hello"');
    expect(canonicalJson(42)).toBe('42');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
  });

  it('produces identical output for differently-ordered objects with same content', () => {
    const a = canonicalJson({ action: 'test', id: '1', timestamp: '2025-01-01' });
    const b = canonicalJson({ timestamp: '2025-01-01', id: '1', action: 'test' });
    expect(a).toBe(b);
  });
});

describe('computeHash', () => {
  it('returns a 64-character hex string', () => {
    const hash = computeHash(
      {
        id: 'test-id',
        timestamp: '2025-01-01T00:00:00.000Z',
        actor: { id: 'user_1', type: 'user' },
        tenantId: 'org_1',
        action: 'test.action',
        resource: { type: 'document', id: 'doc_1' },
      },
      ZERO_HASH,
    );
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different hashes for different events', () => {
    const base = {
      id: 'test-id',
      timestamp: '2025-01-01T00:00:00.000Z',
      actor: { id: 'user_1', type: 'user' },
      tenantId: 'org_1',
      action: 'test.action',
      resource: { type: 'document', id: 'doc_1' },
    };

    const hash1 = computeHash(base, ZERO_HASH);
    const hash2 = computeHash({ ...base, id: 'different-id' }, ZERO_HASH);
    expect(hash1).not.toBe(hash2);
  });

  it('produces different hashes for different previous hashes', () => {
    const event = {
      id: 'test-id',
      timestamp: '2025-01-01T00:00:00.000Z',
      actor: { id: 'user_1', type: 'user' },
      tenantId: 'org_1',
      action: 'test.action',
      resource: { type: 'document', id: 'doc_1' },
    };

    const hash1 = computeHash(event, ZERO_HASH);
    const hash2 = computeHash(event, 'a'.repeat(64));
    expect(hash1).not.toBe(hash2);
  });

  it('is deterministic', () => {
    const event = {
      id: 'test-id',
      timestamp: '2025-01-01T00:00:00.000Z',
      actor: { id: 'user_1', type: 'user' },
      tenantId: 'org_1',
      action: 'test.action',
      resource: { type: 'document', id: 'doc_1' },
    };

    expect(computeHash(event, ZERO_HASH)).toBe(computeHash(event, ZERO_HASH));
  });
});

describe('buildEvent', () => {
  it('creates a complete event with generated ID and timestamp', () => {
    const input: RecordInput = {
      action: 'invoice.created',
      resource: { type: 'invoice', id: 'inv_1' },
      metadata: { amount: 100 },
    };
    const actor = { id: 'user_1', type: 'user', name: 'Alice' };

    const event = buildEvent(input, actor, 'org_1', ZERO_HASH);

    expect(event.id).toHaveLength(21);
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.actor).toEqual(actor);
    expect(event.resource).toEqual(input.resource);
    expect(event.action).toBe('invoice.created');
    expect(event.tenantId).toBe('org_1');
    expect(event.metadata).toEqual({ amount: 100 });
    expect(event.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses explicit actor override from input', () => {
    const input: RecordInput = {
      action: 'system.cleanup',
      resource: { type: 'cache', id: 'all' },
      actor: { id: 'system', type: 'system' },
    };

    const event = buildEvent(input, { id: 'user_1', type: 'user' }, 'org_1', ZERO_HASH);
    expect(event.actor.id).toBe('system');
  });

  it('uses explicit tenantId override from input', () => {
    const input: RecordInput = {
      action: 'admin.action',
      resource: { type: 'org', id: 'org_2' },
      tenantId: 'org_override',
    };

    const event = buildEvent(input, { id: 'user_1', type: 'user' }, 'org_1', ZERO_HASH);
    expect(event.tenantId).toBe('org_override');
  });
});

describe('applyRedaction', () => {
  const baseEvent: AuditEvent = {
    id: 'evt_1',
    timestamp: '2025-01-01T00:00:00.000Z',
    actor: { id: 'user_1', type: 'user', name: 'Alice Smith' },
    resource: { type: 'payment', id: 'pay_1' },
    action: 'payment.processed',
    tenantId: 'org_1',
    metadata: { cardNumber: '4111111111111111', ssn: '123-45-6789', amount: 100 },
    hash: 'abc123',
  };

  it('masks a field keeping the last 4 characters', () => {
    const redacted = applyRedaction(baseEvent, { 'metadata.cardNumber': 'mask' });
    expect(redacted.metadata['cardNumber']).toBe('************1111');
  });

  it('removes a field entirely', () => {
    const redacted = applyRedaction(baseEvent, { 'metadata.ssn': 'remove' });
    expect(redacted.metadata['ssn']).toBeUndefined();
  });

  it('hashes a field with SHA-256', () => {
    const redacted = applyRedaction(baseEvent, { 'actor.name': 'hash' });
    expect(redacted.actor.name).toMatch(/^[a-f0-9]{64}$/);
    expect(redacted.actor.name).not.toBe('Alice Smith');
  });

  it('does not mutate the original event', () => {
    applyRedaction(baseEvent, { 'metadata.cardNumber': 'mask' });
    expect(baseEvent.metadata['cardNumber']).toBe('4111111111111111');
  });

  it('handles multiple redaction rules', () => {
    const redacted = applyRedaction(baseEvent, {
      'metadata.cardNumber': 'mask',
      'metadata.ssn': 'remove',
      'actor.name': 'hash',
    });
    expect(redacted.metadata['cardNumber']).toBe('************1111');
    expect(redacted.metadata['ssn']).toBeUndefined();
    expect(redacted.actor.name).toMatch(/^[a-f0-9]{64}$/);
  });

  it('ignores redaction paths that do not exist on the event', () => {
    const redacted = applyRedaction(baseEvent, { 'metadata.nonexistent': 'remove' });
    expect(redacted).toEqual(baseEvent);
  });

  it('masks short values completely', () => {
    const event = { ...baseEvent, metadata: { pin: '1234' } };
    const redacted = applyRedaction(event, { 'metadata.pin': 'mask' });
    expect(redacted.metadata['pin']).toBe('****');
  });
});
