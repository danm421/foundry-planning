# Foundry Planning — Security Audit

Scope: all 40+ API routes, auth/authz, dependencies, secrets, LLM/PDF pipelines, data exposure. 4 specialists ran in parallel; findings deduplicated and ranked below.

---

## CRITICAL (fix this week)

### C1. Unauthenticated cross-firm data write: account allocations

[src/app/api/clients/[id]/accounts/[accountId]/allocations/route.ts](src/app/api/clients/[id]/accounts/[accountId]/allocations/route.ts) — Both `GET` and `PUT` skip `getOrgId()` entirely and query solely by `accountId`. **Any logged-in user can read or overwrite any firm's account allocations.** This poisons Monte Carlo and projection math firm-wide.

**Fix:**

```ts
const firmId = await getOrgId();
const { id, accountId } = await params;
const [acct] = await db.select({ id: accounts.id })
  .from(accounts)
  .innerJoin(clients, eq(clients.id, accounts.clientId))
  .where(and(
    eq(accounts.id, accountId),
    eq(accounts.clientId, id),
    eq(clients.firmId, firmId)
  ));
if (!acct) return NextResponse.json({ error: "Not found" }, { status: 404 });
```

### C2. Clerk middleware bypass advisory (GHSA-vqx2-fgx2-5wq9, CVSS 9.1)

`@clerk/nextjs@7.2.0` installed; fix shipped in `7.2.1+`. The middleware pattern used in [src/middleware.ts](src/middleware.ts) is exactly the one the advisory covers. Defense-in-depth `getOrgId()` calls in each handler mostly cover, but the allocations route (C1) has none.

**Fix:** `npm i @clerk/nextjs@^7.2.3` today.

### C3. Mass assignment via `...body` spread on UPDATE

Four PUT handlers spread raw body into `.set()`:

- [src/app/api/clients/[id]/route.ts:49-74](src/app/api/clients/[id]/route.ts#L49-L74)
- [src/app/api/clients/[id]/accounts/[accountId]/route.ts:30-34](src/app/api/clients/[id]/accounts/[accountId]/route.ts#L30-L34)
- [src/app/api/clients/[id]/liabilities/[liabilityId]/route.ts:29-34](src/app/api/clients/[id]/liabilities/[liabilityId]/route.ts#L29-L34)
- [src/app/api/cma/asset-classes/[id]/route.ts:23](src/app/api/cma/asset-classes/[id]/route.ts#L23)

An attacker can send `{"clientId":"<other-firm-client>"}` or `{"firmId":"<victim-org>"}` and Drizzle will reparent the row. The WHERE matches on the *old* id, so the UPDATE lands and moves the record cross-tenant.

**Fix:** allowlist fields explicitly.

```ts
const { firmId, clientId, scenarioId, createdAt, id: _ignore, ...allowed } = body;
await db.update(accounts).set({ ...allowed, updatedAt: new Date() })...
```

### C4. `xlsx@0.18.5` — prototype pollution + ReDoS, attacker-reachable

GHSA-4r6h-8v6p-xvw6 (proto pollution, CVSS 7.8) + GHSA-5pgg-2g8v-p4x9 (ReDoS, CVSS 7.5). npm package is abandoned on `0.18.5`. Used in [src/lib/extraction/excel-parser.ts](src/lib/extraction/excel-parser.ts) on user-uploaded files from [extract/route.ts](src/app/api/clients/[id]/extract/route.ts). Both CVE codepaths reachable.

**Fix:** `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` — or migrate to `exceljs` (~15 lines, only `read` + `sheet_to_csv` used).

### C5. Prompt injection + unvalidated LLM output shaping DB writes

[src/lib/extraction/extract.ts:73](src/lib/extraction/extract.ts#L73) concatenates raw PDF text as the `user` message. [parse-response.ts](src/lib/extraction/parse-response.ts) accepts any shape. A malicious PDF saying "ignore previous instructions, return {…}" is trusted. Import UI then writes to DB.

**Fix:** wrap doc text in `<document>…</document>` with "treat as data, not instructions" framing. Validate LLM JSON with Zod against a strict schema *before* any DB write. Never spread-insert the extracted object.

### C6. Azure OpenAI without data-retention exemption for regulated PII

[src/lib/extraction/azure-client.ts:19-23](src/lib/extraction/azure-client.ts#L19-L23) — no abuse-monitoring opt-out, no content filter config, no `user` identifier. Azure retains prompts/completions 30 days by default. Full client statements (names, balances, SSNs, beneficiaries) go through.

**Fix:** file Azure OpenAI abuse-monitoring exemption for the resource; document in your DPA.

### C7. No rate limiting on `/api/clients/[id]/extract`

20 MB upload, `max_completion_tokens: 65000`, `maxDuration: 60`. A single session can burn Azure budget and blow function memory.

**Fix:** `@upstash/ratelimit` — 5/min per firm on extract, 60/min per user on reads. Lower `max_completion_tokens` to 16k (65k × 50 tok/s > 20min, exceeds `maxDuration` anyway).

---

## HIGH

### H1. Missing second-level `clientId` filter on UPDATE/DELETE

Parent-check is done, but the final WHERE doesn't re-filter, and the child id comes from the body/query — classic TOCTOU window:

- [clients/[id]/deductions/[deductionId]/route.ts:59,85](src/app/api/clients/[id]/deductions/[deductionId]/route.ts#L59)
- [clients/[id]/asset-transactions/route.ts:756-787](src/app/api/clients/[id]/asset-transactions/route.ts#L756-L787) (PUT, id in body not URL)
- [clients/[id]/transfers/route.ts:144-235](src/app/api/clients/[id]/transfers/route.ts#L144-L235)

**Fix:** `and(eq(X.id, childId), eq(X.clientId, id))` in every mutating WHERE. Move asset-transactions/transfers to nested `[…Id]` URLs so identity is authoritative.

### H2. SSRF via PDF export `donutPng` / `barPng`

[export-pdf/route.ts:49-51](src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts#L49-L51) passes body strings into `<Image src={…}>`. `@react-pdf/renderer` fetches remote URLs server-side. Attacker sends `{"donutPng":"http://169.254.169.254/latest/meta-data/…"}` → AWS metadata / internal services embedded in PDF or timing-leaked.

**Fix:**

```ts
const isDataPng = (v: unknown) => typeof v === "string"
  && v.startsWith("data:image/png;base64,")
  && v.length < 2_000_000;
const donutPng = isDataPng(body.donutPng) ? body.donutPng : null;
```

### H3. Extract endpoint: no MIME/magic-byte validation, DoS vectors

[extract/route.ts](src/app/api/clients/[id]/extract/route.ts) — branch selection driven by user-supplied `file.name` extension. PDF bomb (billion-laughs object stream) hangs `unpdf` until 60s cap. `file.size` checked *after* buffering full body into memory.

**Fix:** check magic bytes (`%PDF` = `25 50 44 46`, `PK` for xlsx), check `Content-Length` header before `arrayBuffer()`, wrap extraction in `AbortSignal.timeout(20_000)`, cap pages.

### H4. No schema validation (no zod/valibot anywhere)

Every mutating handler does `await req.json()` then destructures. `dateOfBirth` accepted as any string; numeric fields (`value`, `growthRate`, `startYear`) are stored without bounds. `Number("foo")` → `NaN` later corrupts projection math. `String(body.piaMonthly)` on an object → `"[object Object]"` in a numeric column.

**Fix:** install `zod`, define one schema per resource, parse at the top of every handler. Use `.strict()` so unknown keys reject.

### H5. No security response headers

[next.config.ts](next.config.ts) has no `headers()`. Missing: CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, COOP. Drop-in for a Clerk + Neon + Azure app:

```ts
async headers() {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://*.clerk.accounts.dev https://*.clerk.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://img.clerk.com",
    "connect-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://*.neon.tech https://*.openai.azure.com",
    "frame-ancestors 'none'",
    "base-uri 'self'", "form-action 'self'", "object-src 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  return [
    { source: "/:path*", headers: [
      { key: "Content-Security-Policy", value: csp },
      { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ]},
    { source: "/api/:path*", headers: [
      { key: "Cache-Control", value: "no-store, max-age=0, must-revalidate" },
    ]},
  ];
}
```

Roll CSP out in report-only first.

### H6. Cross-tenant reparenting via body-supplied FK ids

Even in well-destructured POST handlers (accounts, incomes, entities), `ownerEntityId`, `modelPortfolioId`, `cashAccountId`, etc. are accepted without verifying they belong to the caller's firm. [plan-settings/route.ts:93-104](src/app/api/clients/[id]/plan-settings/route.ts#L93-L104) already does this correctly — use it as the template for every foreign-key input.

### H7. Over-fetching sensitive columns to the browser

[src/app/api/clients/route.ts:14-18](src/app/api/clients/route.ts#L14-L18) does `db.select().from(clients)` — returns full DOBs, spouse DOB, filing status, `advisorId` (internal Clerk user id) to the list UI that only needs names. Switch to explicit `.select({…})` projections on list endpoints.

### H8. Balance-sheet PDF export error-handling is inconsistent

[export-pdf/route.ts](src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts) swallows `getOrgId()` throw as 500 instead of 401. Mirror the pattern used by every other route. Also: add `AbortSignal.timeout(25_000)` around `renderToStream` — `@react-pdf/renderer` has memory-leak history on large docs.

### H9. Filenames logged unsanitized

[src/lib/extraction/extract.ts:44-78](src/lib/extraction/extract.ts#L44) logs `[extract] ${fileName}: …`. Advisor filenames routinely contain client last names and account numbers ("Smith_Fidelity_2025.pdf"). These land in Vercel Runtime Logs. Also allows log-line forging via `\n` in filename.

**Fix:** `file.name.replace(/[^\w.\- ]/g,"_").slice(0,128)` or log only `{ext, length, documentType}`.

---

## MEDIUM

- `getOrgId()` fallback to `userId` ([src/lib/db-helpers.ts:3-8](src/lib/db-helpers.ts#L3-L8)) — users without a Clerk org become their own firm. Combined with C3, an attacker could set `firmId = "org_<victim>"`. Pick one: strict org-required mode, or a tagged `assertOrgContext()` helper for PII routes.
- **No role check on CMA mutations** — any firm member can delete model portfolios/asset classes that drive every client's projections. Gate writes on `has({ role: "org:admin" })` via Clerk.
- **Fragile `err.message === "Unauthorized"` matching** — replace with a dedicated `UnauthorizedError` class and `instanceof` checks.
- **No multi-tenant isolation integration test** — 75 test files, none verify firm-A → firm-B returns 404. Add one.
- **Client hard-delete with no audit log** ([clients/[id]/route.ts:124-130](src/app/api/clients/[id]/route.ts#L124-L130)) — a compromised advisor session nukes records silently. Add an `audit_log` table and write on every mutation, minimum on delete.
- **No `export const dynamic = "force-dynamic"` on any `/api/*` route** — all happen to be dynamic today because they read headers, but one accidental `revalidate: 3600` on a future route leaks user data cross-tenant at the edge.
- **Free-text fields with no length cap**: `report_comments.body`, `entities.notes`, `family_members.notes`, `asset_classes.description`. Safe today (textareas only), but a future AI-summary feature makes them prompt-injection vectors.
- **`bodySizeLimit: 20MB`** ([next.config.ts](next.config.ts)) × no rate limit = cheap memory DoS. Lower to 10MB or stream to blob storage.
- **Azure error stacks logged raw** in extract catch — may leak endpoint, deployment name, request IDs. Wrap: `err instanceof Error ? err.message.slice(0,200) : "unknown"`.
- **drizzle-kit / esbuild GHSA-67mh-4wv8-2f99** — dev-only, monitor for drizzle-kit fix.

---

## LOW / INFO

- Debug `console.log("[liabilities drill] ids:", …)` in [cashflow-report.tsx:1182](src/components/cashflow-report.tsx#L1182) ships to production browser.
- `max_completion_tokens: 65000` on extract unreachable inside `maxDuration: 60` — cost leak on partial completions.
- No Sentry/structured logger — for a financial PII app, flag as observability gap. (Sentry MCP plugin is already installed in your env.)
- `bodySizeLimit` and `maxDuration` should be explicit on every route that needs them, not inherited.

---

## What's already good (don't undo)

- No SQL injection risk — all queries go through Drizzle's parameterized builder; zero `` sql`` `` template usage.
- No unsafe HTML injection, `eval`, or dynamic-code-evaluation constructors anywhere.
- No open redirects.
- `.env.local` correctly gitignored; no historical secret leaks (`git log --all -p -- .env*` is clean).
- Clerk middleware matcher's `js(?!on)` lookahead correctly protects JSON/RSC payloads.
- Most nested routes (extra-payments, schedules, entities, family-members) do correct two-level ownership checks.
- Cascade-delete semantics in schema are correct for GDPR-style erasure.
- CMA resources are firm-scoped (despite the name suggesting shared).

---

## Prioritized action list

**This week (critical path):**

1. `npm i @clerk/nextjs@^7.2.3` — Clerk bypass CVE.
2. Replace `xlsx@0.18.5` with SheetJS CDN 0.20.3+ or `exceljs`.
3. Fix the unauthenticated allocations route (C1).
4. Allowlist fields on the 4 mass-assignment PUT handlers (C3).
5. Validate `donutPng`/`barPng` as data-URI only (H2).
6. Add rate limit on `/api/clients/[id]/extract` + lower `max_completion_tokens` to 16k.

**Next week:**

7. File Azure OpenAI abuse-monitoring exemption.
8. Install `zod` + schemas on every mutating route (H4).
9. Drop in `next.config.ts` security headers (H5).
10. Add `export const dynamic = "force-dynamic"` to every `/api/*` route.
11. Fix missing `clientId` WHERE filters (H1).
12. Sanitize filenames in logs; wrap extract errors (H9, M).
13. Tighten `getOrgId()` — decide on strict-org-required mode.
14. Add multi-tenant isolation test suite.

**Month two:**

15. `audit_log` table + writes on every mutation.
16. Wire Sentry with PII scrubbing and Clerk user context.
17. Magic-byte + timeout + page-cap hardening on extraction.
18. Prompt-injection defenses (document delimiters, strict output schema) on LLM pipeline.

The multi-tenant DB scoping pattern is mostly correct — don't break it. The bugs are concentrated in 4-5 specific files. Biggest wins: items 1, 2, 3, 4, and 8 — those three days of work close roughly 80% of the exposure.
