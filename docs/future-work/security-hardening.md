# Future Work — Security Hardening (substantially complete, 2026-04-20)

Week-1 (C1-C4, C7, H2), week-2 (H1, H4 partial, H5, H9, most Mediums),
and week-3 (H3, H6, H7, H8, C5, CMA role checks, audit_log table) all
shipped on `security-hardening`.

## Closed 2026-04-20 (second-look audit session)

The original audit was re-verified against live `main` and these
remaining items were closed:

- **`requireOrgId()` rollout** — all 41 `/api/clients/**` and
  `/api/cma/**` handlers swapped from `getOrgId()` → `requireOrgId()`
  (commit `5adee60`). Orgless users now 401 on PII routes instead of
  silently getting a `userId`-keyed ghost workspace.
- **Orgless UX** — new `/select-organization` page + middleware
  redirect so signed-in-but-orgless users hit the Clerk org picker
  before they can reach any firm-scoped route (commit `bcf9d81`).
- **Audit log coverage gap** — `recordAudit()` extended to every
  mutating handler in the tree: 56 call sites across 38 route files
  covering all resource families' create / update / delete
  (commit `bcf9d81`). `AuditAction` enum expanded accordingly.
- **CSP report endpoint** — `/api/csp-report` now accepts both
  legacy (`report-uri`) and modern (`Reporting-Endpoints` /
  `report-to`) violation payloads; sanitized summaries log to
  stdout so ops can observe before flipping to enforcing
  (commit `df90513`). CSP-enforce itself still deferred (see below).
- **extra-payments mass assignment** — last `…body` spread on a
  mutation handler patched with the same identity-strip pattern
  used on `clients/[id]` PUT (commit `5adee60`).
- **`clients/[id]` PUT strip → allowlist** — converted to an explicit
  `MUTABLE_CLIENT_FIELDS` allowlist so a future sensitive schema
  column can't silently become user-writable (commit `df90513`).

## Still open

- **zod coverage gap** — schemas shipped for: `allocations` PUT,
  `asset-classes` PUT, `clients` POST. Reusable schemas defined for
  accounts/incomes/expenses/liabilities POST in
  `src/lib/schemas/resources.ts` but not yet wired into the handlers.
  Pattern established in `src/lib/schemas/common.ts`; each remaining
  route is a 3-line drop-in (import + parseBody + destructure from
  parsed.data). ~25 POST/PUT handlers still unscoped. _Why deferred:
  risk-adjusted — the unwired routes already have mass-assignment
  guards (C3) and FK validation (H6); zod is belt-and-braces._
- **C6** — Azure OpenAI abuse-monitoring exemption. _Why deferred:
  procurement step; steps live in `docs/SECURITY_RUNBOOK.md` §1._
- **Two-firm HTTP integration test** — structural invariant is enforced
  by `src/__tests__/tenant-isolation.test.ts`; full end-to-end still
  needs a Clerk test-double + Postgres harness. _Why deferred: harness
  cost > incremental SOC-2 value given the contract test._
- **Sentry wiring with PII scrubbing + Clerk user context.** _Why
  deferred: would pull a third logging stack in; revisit after first
  real incident._
- **CSP enforce (drop Report-Only)** — report endpoint now live
  (`/api/csp-report`). Needs ~1–2 weeks of clean violation logs in
  prod before flipping the header name in `next.config.ts` from
  `Content-Security-Policy-Report-Only` to `Content-Security-Policy`.
  _Steps in `docs/SECURITY_RUNBOOK.md` §3._
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
- **Clerk webhook rate-limiting.** `/api/webhooks/clerk` is Svix-signed
  (invalid signatures return 401 before any DB work), but the spec
  `2026-04-22-cma-seed-on-org-creation-design.md` also called for a
  60-rpm-per-source-IP Upstash limit as belt-and-braces against
  credential-stuffing of the endpoint. Not shipped in the initial
  implementation. ~15-line add using the existing `src/lib/rate-limit.ts`
  helper. _Why deferred: Svix verification is the primary gate; the
  rate-limiter only defends against rotating-IP abuse, which is a
  lower-priority attack vector for an unauthenticated seed-only
  endpoint that's cheap to execute even on a hit._
