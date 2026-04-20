# Future Work — Engine / Back-end / DB

Deferred items related to the back-end engine, database infrastructure, and
server-side drivers. See `docs/FUTURE_WORK.md` for the full index.

---

## Plan 2 retro (2026-04-20)

- **WebSocket-pool driver promotion for mutation+audit atomicity** —
  `neon-http` cannot span the mutation statement and the `writeAuditLog` INSERT
  in a single transaction. Migrating to `@neondatabase/serverless` Pool
  (WebSocket driver) eliminates the atomicity gap: if the audit write fails,
  the mutation rolls back. Why deferred: accepted gap in Plan 2 retro;
  append-only trigger still catches tampering, and a driver migration has
  broader scope than Plan 2.

- **Drizzle-kit ↔ Neon `__drizzle_migrations` journal resync** — Plan 2 applied
  migration 0039 manually via Neon MCP (same pattern as Plan 1's 0037/0038).
  The repo journal and Neon's `__drizzle_migrations` table remain out of sync
  on shared branches. A one-time reconciliation (decide authoritative lineage
  → reset Neon table → re-apply) is required before any CI-driven migration
  workflow can work. Why deferred: manual-apply-via-MCP workaround works; no
  CI migration workflow exists yet so the drift is harmless today.

- **Per-app DB separation** — admin (`apps/admin`) and web (`apps/web`) share a
  single Neon branch in Plan 2. Splitting them into separate Neon projects or
  branches would provide data isolation (admin schema changes can't affect the
  advisor app's connection pool, and vice versa) and cleaner access-control
  boundaries. Why deferred: Plan 3 decision if we want data isolation; shared
  branch is simpler and sufficient while both apps are owned by a single
  operator.
