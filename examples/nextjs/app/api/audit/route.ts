// Next.js App Router API route demonstrating trailkit.
// In a real app, you'd initialize the audit instance in a shared module
// and use runWithContext for server-side context propagation.

import { NextResponse } from 'next/server';
import { createAuditLog, runWithContext } from 'trailkit';
import { memoryAdapter } from 'trailkit/adapters/memory';

const audit = createAuditLog({
  storage: memoryAdapter(),
  actor: () => ({ id: 'anonymous', type: 'system' }),
  tenant: () => 'default',
});

audit.on('error', (err) => {
  console.error('[audit error]', err.message);
});

export async function POST(request: Request) {
  const body = await request.json();

  // In Next.js App Router, use runWithContext instead of middleware
  await runWithContext(
    {
      actor: { id: 'usr_1', type: 'user', name: 'alice@example.com' },
      tenantId: 'org_acme',
      metadata: {},
    },
    async () => {
      await audit.record({
        action: body.action ?? 'resource.created',
        resource: { type: body.resourceType ?? 'document', id: body.resourceId ?? 'doc_1' },
        metadata: body.metadata ?? {},
      });
    },
  );

  return NextResponse.json({ ok: true });
}

export async function GET() {
  const events = await audit.query({ limit: 50 });
  return NextResponse.json(events);
}
