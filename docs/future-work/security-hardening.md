# Future Work — Security Hardening (substantially complete, 2026-04-20)

Week-1 (C1-C4, C7, H2), week-2 (H1, H4 partial, H5, H9, most Mediums),
and week-3 (H3, H6, H7, H8, C5, CMA role checks, audit_log table) all
shipped on `security-hardening`. Still open:

- **zod coverage gap** — schemas shipped for: `allocations` PUT,
  `asset-classes` PUT, `clients` POST. Reusable schemas defined for
  accounts/incomes/expenses/liabilities POST in
  `src/lib/schemas/resources.ts` but not yet wired into the handlers.
  Pattern established in `src/lib/schemas/common.ts`; each remaining
  route is a 3-line drop-in (import + parseBody + destructure from
  parsed.data). _Why deferred: risk-adjusted — the unwired routes
  already have mass-assignment guards (C3) and FK validation (H6);
  zod is belt-and-braces._
- **C6** — Azure OpenAI abuse-monitoring exemption. _Why deferred:
  procurement step; steps live in `docs/SECURITY_RUNBOOK.md` §1._
- **Two-firm HTTP integration test** — structural invariant is enforced
  by `src/__tests__/tenant-isolation.test.ts`; full end-to-end still
  needs a Clerk test-double + Postgres harness. _Why deferred: harness
  cost > incremental SOC-2 value given the contract test._
- **Sentry wiring with PII scrubbing + Clerk user context.** _Why
  deferred: would pull a third logging stack in; revisit after first
  real incident._
- **CSP enforce (drop Report-Only)** — needs report endpoint + 2 weeks
  of prod data. _Steps in `docs/SECURITY_RUNBOOK.md` §3._
- **`requireOrgId()` rollout** — the strict helper exists but no
  client-facing handlers have been swapped over. _Why deferred: needs
  product input on whether users ever legitimately operate outside an
  org._
- **Audit log coverage gap** — `recordAudit()` is wired into
  client/account/liability/CMA deletes (the high-risk destructive set).
  Incomes, expenses, entities, family-members, deductions, transfers,
  asset-transactions, savings-rules deletes are not yet audited.
  _Why deferred: follow-up sweep, pattern established._
- **Vercel prod env: Clerk test keys in use.** The Vercel project
  currently ships `pk_test_…` / `sk_test_…` Clerk credentials. That
  points prod at Clerk's test instance — test users, no production
  auth hardening, no real billing/bot protection. Create a prod Clerk
  instance, rotate `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` +
  `CLERK_SECRET_KEY` in Vercel to `pk_live_…` / `sk_live_…` before
  onboarding any real customer. _Why deferred: pre-launch; test keys
  are fine for staging._
- **Vercel prod env: Azure OpenAI creds missing.** `AZURE_API_KEY`,
  `AZURE_ENDPOINT`, `AZURE_API_VERSION`, `AZURE_MODEL`,
  `AZURE_ANALYSIS_MODEL` are not set in Vercel. `/api/clients/[id]/extract`
  will 500 on first use in prod until they're added. _Why deferred:
  not yet provisioned; tracked alongside the Azure abuse-monitoring
  exemption (C6) in `docs/SECURITY_RUNBOOK.md` §1._
