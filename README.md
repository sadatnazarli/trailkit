# trailkit

Lightweight, zero-infrastructure audit logging for Node.js and TypeScript.

<p align="center">
  <img src="demo.gif" alt="trailkit demo" width="800" />
</p>

Every B2B SaaS eventually gets the question: "who deleted this?" — from a customer, from a compliance auditor, or from your own team debugging a production incident at 2am. trailkit gives you tamper-evident audit logs that install in minutes, with no external services, no infrastructure to manage, and type-safe APIs that feel native to TypeScript.

```typescript
import { createAuditLog } from 'trailkit';
import { memoryAdapter } from 'trailkit/adapters/memory';

const audit = createAuditLog({
  storage: memoryAdapter(), // or sqliteAdapter, postgresAdapter
  actor: (req) => ({ id: req.user.id, type: 'user', name: req.user.email }),
  tenant: (req) => req.user.organizationId,
});

app.use(audit.middleware());

// Anywhere in your request handling code — actor and tenant are automatic
await audit.record({
  action: 'invoice.payment.initiated',
  resource: { type: 'invoice', id: invoice.id },
  metadata: { amount: invoice.total, currency: 'USD' },
});

// Query with wildcard support
const events = await audit.query({ action: 'invoice.payment.*', limit: 25 });

// Verify nobody tampered with the log
const result = await audit.verify({ tenantId: 'org_123' });
```

## Installation

```bash
npm install trailkit
# or
pnpm add trailkit
```

For SQLite storage (recommended for most apps):
```bash
pnpm add trailkit better-sqlite3
```

For PostgreSQL:
```bash
pnpm add trailkit pg
```

## Features

- **Zero infrastructure** — works with SQLite out of the box. No queues, no external services.
- **Automatic context** — AsyncLocalStorage captures actor and tenant from each request. No manual threading through your call stack.
- **Tamper-evident** — SHA-256 hash chaining detects if anyone modifies stored events. One call to `audit.verify()` checks the entire chain.
- **PII redaction** — mask, remove, or hash sensitive fields before they reach storage. Configure once at init.
- **Fire-and-forget safe** — audit writes never throw or crash your app. Failures emit an error event you can route to your logger.
- **TypeScript-native** — precise types, great IntelliSense, strict mode compatible.
- **Framework-agnostic** — works with Express, Fastify, Koa, and Next.js.

## Storage adapters

```typescript
import { memoryAdapter } from 'trailkit/adapters/memory';    // testing
import { sqliteAdapter } from 'trailkit/adapters/sqlite';      // single-server
import { postgresAdapter } from 'trailkit/adapters/postgres';  // production
```

## PII redaction

```typescript
const audit = createAuditLog({
  storage: sqliteAdapter({ path: './audit.db' }),
  actor: (req) => ({ id: req.user.id, type: 'user', name: req.user.email }),
  tenant: (req) => req.user.orgId,
  redact: {
    'metadata.cardNumber': 'mask',   // ************1111
    'metadata.ssn': 'remove',        // field deleted
    'actor.name': 'hash',            // SHA-256 hash
  },
});
```

## Documentation

- [Express example](./examples/express-basic/)
- [Next.js example](./examples/nextjs/)
- [Contributing guide](./CONTRIBUTING.md)

## License

MIT
