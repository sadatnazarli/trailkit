# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-03-27

### Added

- Core audit logging with `createAuditLog()` factory
- AsyncLocalStorage-based context propagation with framework-agnostic middleware
- SHA-256 hash chaining for tamper detection with `audit.verify()`
- PII redaction (mask, remove, hash) configured at initialization
- Memory adapter for testing and development
- SQLite adapter using better-sqlite3
- PostgreSQL adapter using pg
- Wildcard support in action queries (e.g. `invoice.payment.*`)
- Fire-and-forget error handling via EventEmitter
- `runWithContext()` for background jobs and non-HTTP contexts
- Express and Next.js examples
