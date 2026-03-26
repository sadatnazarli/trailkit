import { describe, it, expect } from 'vitest';
import { createMiddleware, getContext, runWithContext } from '../context.js';

describe('createMiddleware', () => {
  it('stores actor and tenant in AsyncLocalStorage for the duration of next()', async () => {
    const middleware = createMiddleware({
      actor: (req) => {
        const r = req as { user: { id: string } };
        return { id: r.user.id, type: 'user' };
      },
      tenant: (req) => {
        const r = req as { user: { orgId: string } };
        return r.user.orgId;
      },
    });

    const req = { user: { id: 'usr_1', orgId: 'org_1' } };

    await new Promise<void>((resolve) => {
      middleware(req, {}, () => {
        const ctx = getContext();
        expect(ctx).toBeDefined();
        expect(ctx!.actor.id).toBe('usr_1');
        expect(ctx!.tenantId).toBe('org_1');
        resolve();
      });
    });
  });

  it('includes request metadata when a metadata extractor is provided', async () => {
    const middleware = createMiddleware({
      actor: () => ({ id: 'usr_1', type: 'user' }),
      tenant: () => 'org_1',
      metadata: (req) => {
        const r = req as { ip: string };
        return { ip: r.ip };
      },
    });

    await new Promise<void>((resolve) => {
      middleware({ ip: '127.0.0.1' }, {}, () => {
        const ctx = getContext();
        expect(ctx!.metadata).toEqual({ ip: '127.0.0.1' });
        resolve();
      });
    });
  });

  it('returns undefined context outside of middleware scope', () => {
    expect(getContext()).toBeUndefined();
  });
});

describe('runWithContext', () => {
  it('runs a function with explicit context', () => {
    const context = {
      actor: { id: 'system', type: 'system' },
      tenantId: 'org_1',
      metadata: {},
    };

    runWithContext(context, () => {
      const ctx = getContext();
      expect(ctx).toBeDefined();
      expect(ctx!.actor.id).toBe('system');
      expect(ctx!.tenantId).toBe('org_1');
    });
  });

  it('returns the value from the inner function', () => {
    const result = runWithContext(
      { actor: { id: 'sys', type: 'system' }, tenantId: 'org', metadata: {} },
      () => 42,
    );
    expect(result).toBe(42);
  });

  it('supports async functions', async () => {
    const result = await runWithContext(
      { actor: { id: 'sys', type: 'system' }, tenantId: 'org', metadata: {} },
      async () => {
        const ctx = getContext();
        return ctx!.tenantId;
      },
    );
    expect(result).toBe('org');
  });
});
