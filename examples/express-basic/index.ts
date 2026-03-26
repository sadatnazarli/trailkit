// Minimal Express example showing trailkit audit logging.
// Run with: pnpm start (or npx tsx index.ts)

import express from 'express';
import { createAuditLog } from 'trailkit';
import { memoryAdapter } from 'trailkit/adapters/memory';

// In a real app, you'd use sqliteAdapter or postgresAdapter:
// import { sqliteAdapter } from 'trailkit/adapters/sqlite';
// const storage = sqliteAdapter({ path: './audit.db' });

const audit = createAuditLog({
  storage: memoryAdapter(),
  actor: (req) => {
    const r = req as express.Request & { user?: { id: string; email: string } };
    return {
      id: r.user?.id ?? 'anonymous',
      type: 'user',
      name: r.user?.email,
    };
  },
  tenant: (req) => {
    const r = req as express.Request & { user?: { orgId: string } };
    return r.user?.orgId ?? 'default';
  },
});

audit.on('error', (err) => {
  console.error('[audit error]', err.message);
});

const app = express();
app.use(express.json());

// Simulate authentication — in production this would be your auth middleware
app.use((req, _res, next) => {
  (req as express.Request & { user: unknown }).user = {
    id: 'usr_1',
    email: 'alice@example.com',
    orgId: 'org_acme',
  };
  next();
});

// Attach audit context middleware
app.use(audit.middleware() as express.RequestHandler);

// Create an invoice
app.post('/invoices', async (req, res) => {
  const invoiceId = `inv_${Date.now()}`;

  await audit.record({
    action: 'invoice.created',
    resource: { type: 'invoice', id: invoiceId },
    metadata: { amount: req.body.amount, currency: req.body.currency ?? 'USD' },
  });

  res.json({ id: invoiceId, status: 'created' });
});

// Update a user's credit limit
app.patch('/users/:id/credit-limit', async (req, res) => {
  const oldLimit = 1000; // In reality, fetched from your database
  const newLimit = req.body.creditLimit;

  await audit.record({
    action: 'user.creditLimit.updated',
    resource: {
      type: 'user',
      id: req.params.id!,
      before: { creditLimit: oldLimit },
      after: { creditLimit: newLimit },
    },
  });

  res.json({ userId: req.params.id, creditLimit: newLimit });
});

// Query audit log
app.get('/audit', async (req, res) => {
  const events = await audit.query({
    tenantId: req.query.tenantId as string | undefined,
    actorId: req.query.actorId as string | undefined,
    action: req.query.action as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : 50,
  });

  res.json(events);
});

// Verify integrity
app.get('/audit/verify', async (_req, res) => {
  const result = await audit.verify({ tenantId: 'org_acme' });
  res.json(result);
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => {
  console.log(`trailkit express example running on http://localhost:${PORT}`);
  console.log('Try:');
  console.log(`  curl -X POST http://localhost:${PORT}/invoices -H 'Content-Type: application/json' -d '{"amount": 100}'`);
  console.log(`  curl http://localhost:${PORT}/audit`);
  console.log(`  curl http://localhost:${PORT}/audit/verify`);
});
