# Future Work — Admin Tool

Deferred items from admin-tool development. See `docs/FUTURE_WORK.md` for
the full index.

---

## Plan 2 retro (2026-04-20)

- **Audit-coverage sweep for low-risk mutations** — entities, family-members,
  and other low-risk `apps/web/src/app/api/**` handlers are not yet wrapped in
  `auditedMutation`. Pattern established via Plan 2's high-risk set; wrap
  remaining endpoints when touched. Why deferred: Plan 2 scoped to high-risk
  set only.

- **ESLint rule forcing all `apps/web/src/app/api/**` mutation handlers through
  `auditedMutation`** — a `no-restricted-syntax` rule (or custom plugin rule)
  detecting bare `db.insert/update/delete` outside an `auditedMutation` call
  would prevent future drift at lint time. Why deferred: pattern still being
  settled; add after one more iteration.

- **Audit chain verification UI / background verifier** — the DB hash chain is
  tamper-evident (append-only trigger, Plan 1 integration test), but there is
  no operator-facing "verify this session" button or background cron that walks
  the chain. Why deferred: no user-facing demand yet; covers Plan 3 / SOC-2
  audit story.

- **Session renewal UX** — impersonation sessions expire hard at 30 min. A
  banner countdown + "Extend session" button minting a fresh JWT would improve
  ergonomics for admins mid-task. Why deferred: waiting on product input; hard
  expiry is the safer default.

- **`/admin-users` UI + admin-user CRUD** — bootstrap remains manual via Clerk
  dashboard; webhook syncs `admin_users` rows automatically. A CRUD UI at
  `/admin-users` would remove the Clerk-dashboard dependency for managing admin
  access. Why deferred: Plan 2 focus on flow, not meta-admin; single founder
  has no need yet.

- **Prod admin Clerk instance + `admin.foundry-planning.com` DNS flip** — Plan 2
  ships against test keys (`pk_test_…` / `sk_test_…`) on `*.vercel.app` preview
  URLs. Production Clerk provisioning and the custom-domain flip are Plan 3
  cutover work. See `docs/DEPLOYMENT_RUNBOOK.md` §Plan 3. Why deferred: Plan 3
  cutover.

- **Playwright E2E execution** — the happy-path test
  (`apps/admin/tests/impersonation.spec.ts`) is scaffolded and covers the full
  impersonation lifecycle across both preview deployments. Running it requires
  live preview URLs, seeded Clerk test credentials, and Playwright browser
  binaries. Why deferred: deferred to environment with creds; run manually
  after `docs/DEPLOYMENT_RUNBOOK.md` Step 8.
