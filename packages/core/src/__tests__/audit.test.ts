import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuditLog } from '../audit.js';
import { memoryAdapter } from '../adapters/memory.js';
import type { AuditLog } from '../audit.js';

function makeAudit(overrides = {}) {
  return createAuditLog({
    storage: memoryAdapter(),
    actor: (req) => {
      const r = req as { user: { id: string; email: string } };
      return { id: r.user.id, type: 'user', name: r.user.email };
    },
    tenant: (req) => {
      const r = req as { user: { orgId: string } };
      return r.user.orgId;
    },
    ...overrides,
  });
}

function simulateRequest(
  audit: AuditLog,
  user: { id: string; email: string; orgId: string },
  handler: () => Promise<void>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = { user };
    const mw = audit.middleware();
    mw(req, {}, async () => {
      try {
        await handler();
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
}

describe('createAuditLog', () => {
  let audit: AuditLog;

  beforeEach(() => {
    audit = makeAudit();
  });

  it('records an event using actor and tenant from middleware context', async () => {
    await simulateRequest(
      audit,
      { id: 'usr_1', email: 'alice@example.com', orgId: 'org_1' },
      async () => {
        await audit.record({
          action: 'document.created',
          resource: { type: 'document', id: 'doc_1' },
        });
      },
    );

    const events = await audit.query({ tenantId: 'org_1' });
    expect(events).toHaveLength(1);
    expect(events[0]!.actor.id).toBe('usr_1');
    expect(events[0]!.actor.name).toBe('alice@example.com');
    expect(events[0]!.tenantId).toBe('org_1');
    expect(events[0]!.action).toBe('document.created');
  });

  it('records the actor ID from the current request context', async () => {
    await simulateRequest(
      audit,
      { id: 'usr_42', email: 'bob@test.com', orgId: 'org_1' },
      async () => {
        await audit.record({
          action: 'file.uploaded',
          resource: { type: 'file', id: 'file_1' },
        });
      },
    );

    const events = await audit.query({ actorId: 'usr_42' });
    expect(events).toHaveLength(1);
  });

  it('records events with before/after snapshots', async () => {
    await simulateRequest(
      audit,
      { id: 'usr_1', email: 'alice@test.com', orgId: 'org_1' },
      async () => {
        await audit.record({
          action: 'user.creditLimit.updated',
          resource: {
            type: 'user',
            id: 'usr_2',
            before: { creditLimit: 1000 },
            after: { creditLimit: 5000 },
          },
        });
      },
    );

    const events = await audit.query({ tenantId: 'org_1' });
    expect(events[0]!.resource.before).toEqual({ creditLimit: 1000 });
    expect(events[0]!.resource.after).toEqual({ creditLimit: 5000 });
  });

  it('supports wildcard action queries', async () => {
    await simulateRequest(
      audit,
      { id: 'usr_1', email: 'a@test.com', orgId: 'org_1' },
      async () => {
        await audit.record({
          action: 'invoice.payment.initiated',
          resource: { type: 'invoice', id: 'inv_1' },
        });
        await audit.record({
          action: 'invoice.payment.completed',
          resource: { type: 'invoice', id: 'inv_1' },
        });
        await audit.record({
          action: 'user.updated',
          resource: { type: 'user', id: 'usr_2' },
        });
      },
    );

    const results = await audit.query({ action: 'invoice.payment.*' });
    expect(results).toHaveLength(2);
  });

  it('verifies an intact hash chain', async () => {
    await simulateRequest(
      audit,
      { id: 'usr_1', email: 'a@test.com', orgId: 'org_1' },
      async () => {
        await audit.record({
          action: 'first.action',
          resource: { type: 'doc', id: 'doc_1' },
        });
        await audit.record({
          action: 'second.action',
          resource: { type: 'doc', id: 'doc_2' },
        });
      },
    );

    const result = await audit.verify({ tenantId: 'org_1' });
    expect(result.valid).toBe(true);
    expect(result.eventsChecked).toBe(2);
  });

  it('emits an error event instead of throwing when record fails outside context', async () => {
    const errors: Error[] = [];
    audit.on('error', (err) => errors.push(err));

    // Call record without middleware context and without explicit actor
    await audit.record({
      action: 'test.action',
      resource: { type: 'doc', id: 'doc_1' },
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toContain('No actor available');
  });

  it('allows explicit actor and tenantId to override context', async () => {
    await simulateRequest(
      audit,
      { id: 'usr_1', email: 'a@test.com', orgId: 'org_1' },
      async () => {
        await audit.record({
          action: 'system.cleanup',
          resource: { type: 'cache', id: 'all' },
          actor: { id: 'system', type: 'system' },
          tenantId: 'org_override',
        });
      },
    );

    const events = await audit.query({ tenantId: 'org_override' });
    expect(events).toHaveLength(1);
    expect(events[0]!.actor.id).toBe('system');
  });

  it('includes metadata from both context and event input', async () => {
    const auditWithMeta = createAuditLog({
      storage: memoryAdapter(),
      actor: () => ({ id: 'usr_1', type: 'user' }),
      tenant: () => 'org_1',
      metadata: (req) => {
        const r = req as { ip: string };
        return { ip: r.ip };
      },
    });

    await new Promise<void>((resolve) => {
      auditWithMeta.middleware()({ ip: '10.0.0.1' }, {}, async () => {
        await auditWithMeta.record({
          action: 'test.action',
          resource: { type: 'doc', id: 'doc_1' },
          metadata: { custom: 'value' },
        });
        resolve();
      });
    });

    const events = await auditWithMeta.query({});
    expect(events[0]!.metadata).toEqual({ ip: '10.0.0.1', custom: 'value' });
  });
});

describe('PII redaction integration', () => {
  it('redacts fields before storage', async () => {
    const audit = createAuditLog({
      storage: memoryAdapter(),
      actor: () => ({ id: 'usr_1', type: 'user', name: 'Alice Smith' }),
      tenant: () => 'org_1',
      redact: {
        'metadata.cardNumber': 'mask',
        'metadata.ssn': 'remove',
        'actor.name': 'hash',
      },
    });

    await new Promise<void>((resolve) => {
      audit.middleware()({}, {}, async () => {
        await audit.record({
          action: 'payment.processed',
          resource: { type: 'payment', id: 'pay_1' },
          metadata: {
            cardNumber: '4111111111111111',
            ssn: '123-45-6789',
            amount: 100,
          },
        });
        resolve();
      });
    });

    const events = await audit.query({});
    expect(events[0]!.metadata['cardNumber']).toBe('************1111');
    expect(events[0]!.metadata['ssn']).toBeUndefined();
    expect(events[0]!.actor.name).toMatch(/^[a-f0-9]{64}$/);
    // Non-redacted fields are preserved
    expect(events[0]!.metadata['amount']).toBe(100);
  });
});
