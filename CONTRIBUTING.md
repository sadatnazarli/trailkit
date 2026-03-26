# Contributing to trailkit

## Local setup

```bash
git clone https://github.com/sadatnazarli/trailkit.git
cd trailkit
pnpm install
pnpm test
```

## Project structure

- `packages/core/` — the main SDK, published as `trailkit` on npm
- `packages/react/` — optional React UI components (stub)
- `examples/` — runnable examples for Express and Next.js
- Tests live next to the code in `packages/core/src/__tests__/`

## Running tests

```bash
pnpm test          # run all tests once
pnpm test:watch    # re-run on file changes
```

All tests use the in-memory adapter, so they're fast and require no external services.

## PR guidelines

One rule: every PR that adds a feature must include at least one test and an update to the README if the public API changes.

Keep changes focused. A bug fix PR should fix the bug. A feature PR should add the feature. Mixing refactors with features makes review harder.

## Code style

The project uses ESLint and Prettier. Run `pnpm lint` and `pnpm format` before committing. CI will catch it if you forget.
