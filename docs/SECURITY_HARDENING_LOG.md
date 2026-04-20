# Security Hardening — Session Log

Dated: 2026-04-20. Covers the three-week security hardening push and the
infrastructure/deployment work that followed. Cross-references the
permanent docs rather than duplicating them.

---

## Phase 0 — Audit intake

Four specialist agents ran in parallel against the 40+ API routes,
auth/authz, dependency graph, secrets, LLM pipeline, and data-exposure
surface. Findings deduplicated and triaged into
[SECURITY_AUDIT.md](SECURITY_AUDIT.md).

Risk breakdown: 7 Critical, 9 High, 10 Medium, 4 Low.

## Phase 1 — Week-1 critical fixes

Landed on the `security-hardening` branch, 6 commits covering the
"this week" bucket.

| Item | Fix | Key file(s) |
|---|---|---|
| C1 | Firm-scoped `/accounts/[id]/allocations` (was unauth) | `src/app/api/clients/[id]/accounts/[accountId]/allocations/route.ts` |
| C2 | `@clerk/nextjs` 7.2.0 → 7.2.3 (GHSA-vqx2-fgx2-5wq9) | `package.json` |
| C3 | Mass-assignment guards on 4 PUT handlers | `clients/[id]/route.ts` + 3 siblings |
| C4 | `xlsx@0.18.5` → `exceljs@4.4.0` (proto pollution + ReDoS) | `src/lib/extraction/excel-parser.ts` |
| C7 | Upstash rate-limit on `/extract`, fail-closed | `src/lib/rate-limit.ts` (new) |
| H2 | SSRF fix: PDF export accepts only `data:image/png;base64,` | `balance-sheet-report/export-pdf/route.ts` |

## Phase 2 — Week-2 infrastructure + mediums

8 commits.

| Item | Fix | Key file(s) |
|---|---|---|
| H5 | CSP (report-only) + HSTS + XFO + COOP + Permissions-Policy | `next.config.ts` |
| M | `UnauthorizedError` class + `requireOrgId()` strict helper | `src/lib/db-helpers.ts` |
| H9 | Filename sanitization + Azure error truncation | `src/lib/extraction/extract.ts` |
| H1 | `clientId` WHERE on mutating routes | deductions, asset-transactions |
| M | `force-dynamic` on all 41 `/api/*` routes | bulk via script |
| H4 (partial) | zod + `parseBody` pattern, 2 routes | `src/lib/schemas/common.ts` (new) |
| M | Tenant-isolation contract test (83 routes × 2 assertions) | `src/__tests__/tenant-isolation.test.ts` (new) |
| Ops | `docs/SECURITY_RUNBOOK.md` | runbook |

## Phase 3 — Week-3 remaining audit items

7 commits.

| Item | Fix | Key file(s) |
|---|---|---|
| H3 | Magic-byte + `Content-Length` + unpdf timeout + 50-page cap | `src/lib/extraction/validate-upload.ts` + `pdf-parser.ts` |
| C5 | `<document>` delimiters + strict zod output validation | `src/lib/extraction/extraction-schema.ts` (new) |
| H6 | Firm-scoped FK validation across 10 POST/PUT handlers | `src/lib/db-scoping.ts` (new) |
| H8 | 25-s `AbortSignal` race on `renderToStream` | `balance-sheet-report/export-pdf/route.ts` |
| H7 | Explicit projection on `/api/clients` list | `src/app/api/clients/route.ts` |
| M | `requireOrgAdmin()` gating all CMA mutations | `src/lib/authz.ts` (new) |
| M | `audit_log` table + `recordAudit()` on destructive ops | `src/db/migrations/0037_audit_log.sql`, `src/lib/audit.ts` (new) |

## Phase 4 — Merge

- PR #1 opened + merged to `main` as merge commit `0075a76`.
- Remote branch `security-hardening` deleted; worktree removed.
- Journal sync commit `118d5d6` regenerated 0037 migration via
  `drizzle-kit generate` so future `drizzle-kit migrate` runs stay
  consistent with schema.

## Phase 5 — Infrastructure wiring

### Neon (Postgres, application data)

- `0037_audit_log` migration applied live via
  `drizzle-kit migrate` against
  `ep-little-mud-amq8kw04.c-5.us-east-1.aws.neon.tech`.
- No data backfill needed; table starts empty, populates on first
  destructive mutation (`client.delete` / `account.delete` / etc.).

### Vercel project `dans-projects-f6d71a8d/foundry-planning`

- Linked via `vercel link` from the repo root (`.vercel/project.json`
  is local, gitignored).
- Environment variables set in **both** production and preview via
  the Vercel REST API (CLI had a preview-branch scoping bug):

  | Variable | Source | Notes |
  |---|---|---|
  | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` | **TEST key — rotate before customer launch** |
  | `CLERK_SECRET_KEY` | `.env.local` | **TEST key — rotate before customer launch** |
  | `NEXT_PUBLIC_CLERK_SIGN_IN_URL` | `.env.local` | `/sign-in` |
  | `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | `.env.local` | `/sign-up` |
  | `NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL` | `.env.local` | `/clients` |
  | `NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL` | `.env.local` | `/clients` |
  | `DATABASE_URL` | `.env.local` | Neon prod |
  | `UPSTASH_REDIS_REST_URL` | Upstash dashboard | `capital-tapir-103058.upstash.io` |
  | `UPSTASH_REDIS_REST_TOKEN` | Upstash dashboard | **Rotate — shared in chat transcript** |

- **Not yet set (will 500 on first call):**
  `AZURE_API_KEY`, `AZURE_ENDPOINT`, `AZURE_API_VERSION`,
  `AZURE_MODEL`, `AZURE_ANALYSIS_MODEL`.

- Production deploy: `dpl_4B9YRiKhPB1ah2ebHf6L3uGREDmk`
  at `foundry-planning-qqf5hrlc3-dans-projects-f6d71a8d.vercel.app`.

### Upstash (Redis, rate-limit state)

- Region: `us-east-1` (matches Vercel deploy region).
- Plan: Free (10k commands/day, 256 MB).
- Only consumer: `src/lib/rate-limit.ts`, keyed `rl:extract:<firmId>`,
  5 calls per rolling minute.
- Fail-closed behavior: if env vars are absent at runtime, the
  `/api/clients/[id]/extract` endpoint returns 503. Verified in the
  audit commit `422c376`.

## Credentials exposed in chat transcript — rotate

1. **Upstash REST Token** — Upstash dashboard → database →
   "REST API" panel → "Reset Token" (or similar). Paste new
   value; I'll swap it in Vercel.
2. **Vercel Personal Token** (`vcp_7Th8…`) — at
   <https://vercel.com/account/tokens>. Safer to scope the
   replacement to `foundry-planning` only rather than
   full-access.

Both rotations take under a minute and invalidate the values that
appeared in this session.

## Smoke tests to run post-deploy

1. **Rate limit.** Log in to prod, upload a small PDF 6× in one
   minute through the client-data import flow. 7th call should
   return HTTP 429 with a `Retry-After` header. Upstash Data
   Browser should show `rl:extract:<firmId>` keys incrementing.

2. **Audit log.** Delete a test client. Then locally:
   ```
   set -a; source .env.local; set +a
   psql "$DATABASE_URL" -c \
     "SELECT action, resource_id, actor_id, created_at
      FROM audit_log ORDER BY created_at DESC LIMIT 5;"
   ```
   Expect a row with `action = 'client.delete'`.

3. **CMA role gate.** Sign in as a non-admin firm member, attempt
   to POST `/api/cma/asset-classes`. Expect HTTP 403.

4. **SSRF block.** `curl -X POST` the balance-sheet PDF export
   with `{"donutPng":"http://169.254.169.254/latest/meta-data/"}`
   — rendered PDF should not contain that URL's response body.
   Donut chart area should just be empty.

## Status summary

- Audit items shipped: **C1-C5, C7, H1-H9**, and most Mediums
  (headers, `force-dynamic`, `UnauthorizedError`, CMA role gate,
  `audit_log`, log sanitization, tenant-isolation contract test).
- Open items: tracked explicitly in
  [FUTURE_WORK.md](FUTURE_WORK.md) under the
  "Security Hardening (substantially complete, 2026-04-20)"
  section. Key ones:
  - **C6** — Azure abuse-monitoring exemption filing
  - **zod coverage** — 22 remaining handlers (pattern set)
  - Clerk test → live key rotation before launch
  - Azure OpenAI creds in Vercel
  - CSP enforce (drop Report-Only) after 2 weeks of prod data
  - Audit-log coverage expansion to remaining destructive ops
- Operational procedures: captured in
  [SECURITY_RUNBOOK.md](SECURITY_RUNBOOK.md).

## Where things live

- Audit: [SECURITY_AUDIT.md](SECURITY_AUDIT.md)
- Operational runbook: [SECURITY_RUNBOOK.md](SECURITY_RUNBOOK.md)
- Open items: [FUTURE_WORK.md](FUTURE_WORK.md)
- This log: [SECURITY_HARDENING_LOG.md](SECURITY_HARDENING_LOG.md)
- Shipped code: `git log main --grep '^security' --since=2026-04-01`

Last commit in the series at time of writing: `03fe8a8`
(docs/future_work note about Clerk test keys + missing Azure creds).
