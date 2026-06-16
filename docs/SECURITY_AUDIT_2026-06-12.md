# Foundry Planning — Production Security Analysis (2026-06-12)

**Scope:** the full production application — all 177 API route handlers, 6 Server Actions, the Clerk
middleware chokepoint, tenant-isolation core, the document-extraction/LLM/PDF pipeline, CRM (households,
documents, tasks), CMA, billing/Stripe/Clerk webhooks, crons, dependencies, secrets/config, and
security headers.

**Method:** 14 specialist agents ran in parallel — 9 sliced the route surface for exhaustive
per-route coverage, 5 ran thematic deep-dives (dependencies, secrets/config/logging, extraction/LLM/SSRF,
tenant-isolation core, webhooks/billing/crons). Every raw finding (51) was then independently
**adversarially verified against the live code** — the verifier assumed false-positive until the code
proved otherwise, and checked each claim against the actual middleware + auth helpers + DB scoping before
confirming. This stage downgraded several inflated claims and eliminated one false positive.

> This supersedes the April [docs/SECURITY_AUDIT.md](SECURITY_AUDIT.md). The vast majority of that
> audit's CRITICAL/HIGH items (unauth allocations route, mass-assignment spreads, missing headers, no
> zod, no rate limiting, no audit log, prompt-injection, SSRF in PDF export) have since been **fixed** and
> were verified closed. What remains is a much smaller, lower-severity set concentrated in a handful of
> routes that drifted from the codebase's own well-established patterns, plus dependency hygiene.

---

## Executive summary

**Overall posture: solid.** There are **no critical findings and no confirmed cross-tenant data-exposure
or auth-bypass vulnerabilities.** Tenant isolation — the property that matters most for a multi-tenant
financial-PII app — is enforced **at the handler + DB layer** (`requireOrgId()` / `requireClientAccess()`
/ firm-scoped queries) **independently of the bypassable Clerk middleware**, so it survives even a
framework middleware bug. The verifier confirmed this by spot-checking the routes that *looked*
unauthenticated and finding handler-level scoping in every case.

The real findings cluster into four themes:

1. **Dependency hygiene is behind** — `next@16.2.3` and the Clerk packages sit at the top of known
   vulnerable ranges; `xlsx@0.18.5` (prototype-pollution + ReDoS, no npm fix) is bundled into a
   production route. These are the two **High** items and the cheapest, highest-leverage fixes.
2. **A few routes drifted from the FK-validation pattern** — ~7 handlers accept a body-supplied foreign
   key (account / model-portfolio / entity / charity id) and write it without the `assert*InClient/Firm`
   check that ~15 sibling routes apply. None is a cross-tenant *read* (downstream loaders are firm-scoped),
   but each is a stored cross-tenant reference / data-integrity break.
3. **A few routes skip zod validation / rate-limiting / audit** that their siblings have — financial
   fields coerced raw, two compute endpoints unmetered, one estate resource unaudited.
4. **Latent staff-scope + hardening gaps** — the `org:planner`/`org:operations` staff roles are *dormant*
   (no live user can hold them), so several "staff visibility" divergences (search, CRM single-household)
   are not exploitable today but will regress the moment those roles are reactivated.

| Severity | Count | Nature |
|---|---|---|
| Critical | 0 | — |
| High | 2 | Dependency: `next` out of date (DoS), `xlsx` proto-pollution/ReDoS reachable |
| Medium | 11 | FK-reparenting (4), input validation (2), rate-limit (1), upload/blob access (2), Excel DoS (1), Clerk advisory (1) |
| Low | 29 | FK/zod/audit/rate-limit consistency gaps, dep-hygiene (overrides), CSP report-only, Sentry PII scrub, dormant staff-scope drift |
| Info | 8 | Cron timing, lax `getOrgId()` on pages, header nicety, Azure `user` tag, fail-open semantics (dormant) |

**The 80/20:** the two dependency Highs + the seven FK-validation gaps + adding zod/audit/rate-limit to
the five drifted routes close essentially all of the exposure, and most are ~5–15 line edits that copy an
existing in-repo pattern.

---

## What's already strong — do not undo

The audit explicitly verified these controls are present and correct. Preserve them:

- **Handler-level tenant scoping is the real boundary.** Every PII route calls `requireOrgId()` (strict —
  throws on missing org, no `userId` fallback) and scopes queries by `firmId`; per-client routes go through
  `requireClientAccess()` / `verifyClientAccess()` which enforce firm membership **and** staff↔advisor
  visibility, returning **404** (not 403) on a miss so existence never leaks. This is independent of the
  middleware.
- **FK-validation discipline** (`src/lib/db-scoping.ts`) is applied by ~15 routes to stop cross-tenant
  reparenting. The gaps below are the *exceptions*, not the rule.
- **Fail-closed rate limiting** (`src/lib/rate-limit.ts`, Upstash) on extract/import/projection/PDF/
  checkout/beta/feedback — blocks rather than degrading to an in-memory fallback.
- **Mutations are audited** (`src/lib/audit.ts`) — including a `billing.access_denied` trail in middleware.
- **Signed webhooks** (Clerk via svix, Stripe via signature on the raw body) with an idempotency table.
- **Crons self-protect** with a Bearer `CRON_SECRET` check on every route (fail-closed when unset).
- **Security headers** present: HSTS w/ preload, `X-Frame-Options: DENY`, `frame-ancestors 'none'`,
  nosniff, Referrer-Policy, Permissions-Policy, COOP.
- **No SQL injection** (all Drizzle parameterized), **no secrets in git** (`.env*` gitignored, history
  clean), **no `eval`/dynamic code**, no hardcoded keys in `src/`.
- **Extraction pipeline hardened**: SSN redaction before the LLM call, Azure ZDR documented, strict zod on
  single-pass LLM output, magic-byte gate + page cap + 20s timeout on the **PDF** path, data-URI-only
  validation on PDF-export images (prior SSRF closed).

---

## High findings

### H1 — `next@16.2.3` is ~6 patch releases behind; unauthenticated DoS + middleware-bypass advisories
**Files:** [package.json](../package.json) · **Driver advisory:** GHSA-8h8q-6873-q5fj (Server-Components DoS, CVSS 7.5, **unauthenticated**)

`npm audit` flags 14 advisories on the 16.x line, all fixed by **`next@16.2.9` (non-breaking minor)**.
The genuinely-applicable, unmitigated one is the **Server-Components DoS** — network-reachable, no auth, no
app-level shield (per-endpoint rate limits don't cover a framework DoS). The App-Router **middleware/proxy
bypass** family (GHSA-492v-c6pp-mqqv 8.1, GHSA-26hh-7cqf-hhc6, GHSA-267c-6grr-h53f) matters as
defense-in-depth but is **not** a tenant-isolation emergency here: scoping lives in the handlers, not the
proxy. (The SSRF/CSP-nonce/Cache-Components/Image advisories in the set don't match this app's surface —
no WebSocket upgrades, no nonces, no `use cache`, no custom `images` config.)

**Fix:**
```bash
npm install next@16.2.9 eslint-config-next@16.2.9
npm run build && npm test && npm run lint
```

### H2 — `xlsx@0.18.5` (SheetJS) prototype pollution + ReDoS, reachable from authenticated CRM import
**Files:** [src/lib/crm/import.ts](../src/lib/crm/import.ts) (`XLSX.read` on the upload buffer) ← [src/app/api/crm/import/preview/route.ts](../src/app/api/crm/import/preview/route.ts) · GHSA-4r6h-8v6p-xvw6 (proto-pollution, 7.8), GHSA-5pgg-2g8v-p4x9 (ReDoS, 7.5)

`xlsx@0.18.5` is listed under `devDependencies` **but Turbopack inlines it into the production route chunk**
— so it ships and runs on attacker-controlled `.xlsx` uploads. `npm audit` reports `fixAvailable: false`
because SheetJS left the npm registry; a plain `npm update` cannot remediate it. Prototype pollution
corrupts process-global `Object.prototype` (affects all tenants on that instance); ReDoS pins a worker.
Bounded below critical by `requireOrgId` + 30/min rate limit + 5 MB cap, but still **High**.

**Fix (preferred):** the import flow only needs CSV — restrict the upload to CSV, add a magic-byte reject
for ZIP (`50 4B 03 04` = xlsx) / OLE2 (`D0 CF 11 E0` = xls) *before* parsing, parse with a hardened CSV
parser, and **remove the `xlsx` import** (the package being in `package.json` is irrelevant; removing the
*import* is what drops the bundled vulnerable code). Update `crm-import-wizard.tsx` `accept` to `.csv`.
**Fix (if xlsx must stay):** pin the patched SheetJS CDN build —
`npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (≥0.20.2 clears both) — or migrate to the
already-present `exceljs`. Either way, add magic-byte validation (this path currently has none).

---

## Medium findings

### Reparenting — body FK written without `assert*` validation
Same class in all of these: authenticated, own-client only, no cross-tenant *read* (downstream loaders are
firm/client-scoped, so a foreign id resolves to nothing), but a stored cross-tenant reference + data-integrity
break, and an inconsistency with the ~15 sibling routes that *do* validate. Fix = one `assert*InClient/Firm`
call copied from a sibling.

- **M1** [plan-settings PUT](../src/app/api/clients/[id]/plan-settings/route.ts) writes **4** FKs unchecked —
  `modelPortfolioIdTaxable/Cash/Retirement` (need `assertModelPortfoliosInFirm`) + `surplusSaveAccountId`
  (needs `assertAccountsInClient`). Only `selectedBenchmarkPortfolioId` is validated today. *(Also covers the
  "cross-firm allocation composition" and "no zod" low-findings on this same file — the global
  `modelPortfolioAllocations` load is gated by the firm-scoped portfolio fetch, so add the FK checks + a
  `.strict()` zod schema and all three are closed.)*
- **M2** [entities POST](../src/app/api/clients/[id]/entities/route.ts) + [PUT](../src/app/api/clients/[id]/entities/[entityId]/route.ts) write CLT/CRT `splitInterest.charityId` (FK to `external_beneficiaries`) unchecked, while `measuringLife1Id/2Id` right beside it **are** client-scoped. Add the same lookup (or a new `assertExternalBeneficiariesInClient` helper).
- **M3** [withdrawal-strategy POST/PUT](../src/app/api/clients/[id]/withdrawal-strategy/route.ts) write body `accountId` without `assertAccountsInClient` (sibling `reinvestments` does).
- **M4** [savings-rules POST/PUT](../src/app/api/clients/[id]/savings-rules/route.ts) — same `accountId` gap; note `onDelete: cascade` means a later delete of the cross-linked foreign account would cascade-delete the caller's rule.

### Input validation
- **M5** [POST /api/cma/asset-classes](../src/app/api/cma/asset-classes/route.ts) inserts `geometricReturn`, `volatility`, the four `pct*` fields etc. **raw**, with no zod parse — while the sibling **PUT** validates all of them via `assetClassPutSchema`. In-range-but-invalid values (e.g. `volatility: "50"`) store silently and poison **every client's projection** for the firm; non-numeric values 500 instead of 400. Add a mirroring `assetClassPostSchema`. *(Admin-gated, so data-integrity only — not tenant/auth.)*

### Rate limiting / DoS
- **M6** [rebalance/compute](../src/app/api/clients/[id]/rebalance/compute/route.ts) has **no rate limit** while every sibling compute route gates on `checkProjectionRateLimit`. Worse than self-CPU: it runs the **full projection engine** per call *and* fans out to the metered **EODHD** API once per uncached ticker, and the `holdings` array has **no `.max()`** — one request can trigger dozens/hundreds of billed outbound calls. Add the rate-limit gate (prefer a dedicated `rl:rebalance` bucket) **and** cap the holdings array.
- **M7** [extraction/excel-parser.ts](../src/lib/extraction/excel-parser.ts) has **no timeout, no cell/row/sheet cap** — the PDF parser has both (`MAX_PAGES=300`, 20s `Promise.race`). A 20 MB XLSX (a ZIP) can inflate to GBs / millions of cells and pin a function to the 300s wall or OOM (the extract route runs 5 files concurrently). Mirror the PDF hardening: 20s timeout race + cell budget + prefer the streaming `WorkbookReader`. *(Authenticated + 5/min, so per-tenant availability, not data access.)*

### Upload / blob access control
- **M8** [CRM task attachments](../src/lib/crm-tasks/files.ts) are stored as **`access: "public"`** and the raw public blob URL is persisted + rendered as the "Open" link — unlike CRM **documents**, which use a private store streamed through an authz'd route. The path embeds a 122-bit UUID (unguessable, not enumerable) and the link is `rel="noopener noreferrer"`, so it's **leak-dependent**, not openly listable — hence Medium not High. Bring task files in line with the document pattern: `access: "private"` + an authz'd streaming download route.
- **M9** [CRM document + task uploads](../src/lib/crm/documents.ts) do **no MIME/magic-byte validation** — the in-repo `detectUploadKind` helper exists but isn't wired here. The realistic vector is narrow (a `.html`/`.svg`-*named* file served inline from the *public* task-blob origin — a separate origin from the app, so no session theft; document downloads force `Content-Disposition: attachment` and are neutralized). Sniff magic bytes on both paths; pass `contentType: "application/octet-stream"` to the public `put()`.

### Dependencies
- **M10** Clerk advisory **GHSA-w24r-5266-9c3c** (CVSS 8.1, "authz bypass when combining org/billing/reverification checks") — `@clerk/nextjs@7.2.3` + `@clerk/backend@3.2.13` sit at the top of the vulnerable range. **Verified not on this app's path**: the code reads raw claims (`orgId/orgRole/sessionClaims`) and runs its *own* pure decision functions (`decideAccess`, `operationsBlocked`, `roleHasCapability`) — it never calls Clerk's `auth.protect({role,…})` / `has({…})` / `<Protect>` helpers the advisory targets. Still, upgrade as routine hygiene: `npm i @clerk/nextjs@^7.3.0 && npm dedupe`. This **also** closes M11.
- **M11** `js-cookie@3.0.5` (GHSA-qjx8-664m-686j) pulled transitively via `@clerk/shared`. No direct app usage; mediated entirely by Clerk. **Rides along with the M10 Clerk upgrade** — no separate action.

---

## Low & Info findings (grouped)

**FK-validation consistency (same class as M1–M4, lower blast radius):**
- [liabilities PUT](../src/app/api/clients/[id]/liabilities/[liabilityId]/route.ts) spreads `...body` into `.set()` and skips the `parentAccountId`/`linkedPropertyId` checks the POST performs — also lets `scenarioId` be reassigned. Allowlist fields + validate FKs.
- [entity beneficiaries PUT](../src/app/api/clients/[id]/entities/[entityId]/beneficiaries/route.ts) writes `entityIdRef` unchecked (the account-beneficiaries sibling validates it). Add `assertEntitiesInClient`.
- [stock-option-accounts](../src/app/api/clients/[id]/stock-option-accounts/route.ts) `destinationAccountId` unchecked. Add `assertAccountsInClient`.
- [scenario changes-writer / sale-to-trust](../src/lib/scenario/changes-writer.ts) — FK ids inside the opaque `scenario_changes.payload` (and `sale-to-trust` `trustEntityId`) are never client-validated. Validate `trustEntityId` before persisting.

**Missing zod validation (raw `Number()/String()` coercion → `NaN`/`[object Object]` into numeric columns):**
- [medicare-coverage PUT](../src/app/api/clients/[id]/medicare-coverage/route.ts), [family-members POST/PUT](../src/app/api/clients/[id]/family-members/route.ts), [report-comments PUT](../src/app/api/clients/[id]/report-comments/route.ts) (also uncapped body, no rate limit), [plan-settings PUT](../src/app/api/clients/[id]/plan-settings/route.ts) (folded into M1). Add `.strict()` schemas like the neighboring routes.
- [imports/commit/holdings.ts](../src/lib/imports/commit/holdings.ts) — LLM-extracted `shares/price/costBasis/marketValue` are `String()`-coerced with only a `?? 0` guard (`looseObject` doesn't type-check fields). Add a finite-number coercion helper.
- [extraction/extract.ts multi-pass](../src/lib/extraction/extract.ts) — the fact-finder branch skips the strict `extractedPayloadSchema` + per-list caps that single-pass enforces. Run the flattened payload through the same schema.

**Missing audit / entitlement / rate-limit parity:**
- [external-beneficiaries](../src/app/api/clients/[id]/external-beneficiaries/route.ts) create/update/delete are **not audited** (every sibling estate resource is). Add `recordAudit`.
- [per-file re-extract](../src/app/api/clients/[id]/imports/[importId]/files/[fileId]/extract/route.ts) omits the `requireActiveSubscription()` + `ai_import` entitlement gate the **bulk** extract route enforces. Add both for fail-closed parity. *(Reported twice — findings 24 & 39 — same route.)*
- [CMA endpoints](../src/app/api/cma/ticker-portfolios/[id]/stats/route.ts) have no rate limit; `stats` runs a covariance/Sharpe compute. Admin-gated, so low — add a `rl:cma:stats` bucket if desired.

**Latent staff-scope drift (dormant `org:planner`/`org:operations` roles — not exploitable today):**
- [clients/search](../src/app/api/clients/search/route.ts) filters by `firmId` only, skipping the `advisorScopeCondition` the client **list** applies — a book-scoped planner could search the whole firm. Firm boundary is intact; activates only when the planner role + `staff_advisor_visibility` writer are reactivated. Bring to parity + add a `planner-scope` test so the contracts can't silently drift.
- [CRM single-household](../src/lib/crm/authz.ts) `requireCrmHouseholdAccess` + the get/update/delete/restore helpers scope by `firmId` only, bypassing the advisor visibility the list/vault paths apply. Same dormancy caveat. Add the staff check to the shared funnel.
- [household `advisorId`](../src/lib/crm/schemas.ts) accepted as an arbitrary string on create/update with no firm-membership validation → a household can be orphaned to a non-member. Add `assertAdvisorInFirm`.
- [staffMaySeeAdvisor / resolveVisibleAdvisorIds](../src/lib/clients/authz.ts) **fail open** (grant `VISIBLE_ALL`) when `orgRole` is null/unknown. Internally consistent and firm boundary runs first; harden to fail-closed for the "unknown role" case **before** the staff roles go live.

**Dependency hygiene (transitive; pin via a `package.json` `overrides` block — no code change):**
- `fast-uri ≤3.1.1` (GHSA-q3j6 / GHSA-v39h, path-traversal/host-confusion) → `overrides: { "fast-uri": ">=3.1.2" }`. Build-time only.
- `uuid <11.1.1` via `exceljs`/`svix` (GHSA-w5hq, OOB write) → `overrides: { "uuid": ">=11.1.1" }`. No reachable sink.
- `path-to-regexp 6.1.0` via `@vercel/config` (GHSA-9wv6, ReDoS) — **build/config only** (`vercel.ts` uses it for crons). The only npm "fix" is a semver-major downgrade that loses the v1 API; track upstream, don't downgrade.
- `esbuild ≤0.24.2` via `drizzle-kit`'s abandoned `@esbuild-kit` chain (GHSA-67mh, dev-server SSRF) — **dev/CLI only**. Don't take the `drizzle-kit@0.18.1` major downgrade; track upstream or add an `override`.

**Config / headers / logging / hardening (defense-in-depth):**
- [CSP is Report-Only](../next.config.ts) with `'unsafe-inline' + 'unsafe-eval'` → **zero runtime XSS containment today**. Wire per-request nonces in middleware, drop `'unsafe-inline'`, then flip to enforcing. (Tracked in the original audit; still open.)
- [Sentry `enableLogs: true`](../sentry.server.config.ts) with no `beforeSend`/`beforeSendLog` scrubber — `sendDefaultPii:false` only suppresses *auto-attached* request data, not PII the app puts into an Error message/log arg. Add a shared scrubber (reuse `redact-ssn.ts` + strip emails/long digit runs).
- [Security headers](../next.config.ts) omit `Cross-Origin-Resource-Policy` — add `same-origin` (cheap; **do not** add COEP, it breaks Clerk/Sentry/Blob).
- [Cron Bearer compare](../src/app/api/cron/purge-expired-firms/route.ts) is plain `!==` (not constant-time) — a timing side-channel on `CRON_SECRET`, and two of these crons are **destructive**. Extract a shared `requireCronAuth()` using `crypto.timingSafeEqual` and reuse across all 5. *(Findings 45 & 50 — same issue, two files.)*
- [Azure OpenAI calls](../src/lib/extraction/azure-client.ts) send no `user` identifier / content-filter for abuse traceability. Thread an HMAC'd per-firm tag.
- [billing/portal `return_url`](../src/app/api/billing/portal/route.ts) is built from the caller `Origin` header — not an open redirect (the real redirect uses Stripe's URL), but pin to `NEXT_PUBLIC_APP_URL` anyway.
- [Stripe webhook](../src/app/api/webhooks/stripe/route.ts) re-runs handlers when a prior row is `result === null` (in-flight) with no row/advisory lock → possible duplicate provisioning on fast redelivery. Add a `pg_try_advisory_xact_lock` keyed on `event.id`, or only re-run on terminal-error rows.
- [csp-report endpoint](../src/app/api/csp-report/route.ts) is public with no body cap / rate limit — bound the read to ~16 KB and/or add a `rl:csp-report` bucket.
- [import/preview](../src/app/api/crm/import/preview/route.ts) + [onboarding PATCH](../src/app/api/clients/[id]/onboarding/route.ts) — minor: add a magic-byte gate (preview) / `requireImportAccess` on `activeImportId` (onboarding, a UI pointer only).
- [~15 client-detail pages](../src/app/(app)/clients/[id]) derive `firmId` via **lax `getOrgId()`** (userId fallback) instead of `requireOrgId()`. The parent layout is the strict gate today, so not an active vuln; swap to `requireOrgId()`/`requireClientAccess()` so each page self-protects.
- [tenant-isolation.test.ts](../src/__tests__/tenant-isolation.test.ts) — the structural guard test treats lax `getOrgId()` == strict `requireOrgId()` and only checks the helper is *called*, not that `firmId` reaches the WHERE/VALUES. Tighten it (recognize the wrappers, reject the lax variant on PII mutations) so it actually backs the invariant.

---

## Investigated, **not** a vulnerability (verifier refuted)

- **Vault zip export "zip-slip"** ([documents/zip/route.ts](../src/app/api/crm/households/[id]/documents/zip/route.ts)) — the raw stored `filename` *is* passed into `archive.append({ name })`, but `archiver@7.0.1` runs every entry name through `archiver-utils` `sanitizePath` (strips leading `../`, leading `/`, drive/scheme prefixes) **before** writing the zip, neutralizing the traversal vectors. No path traversal. *(Optional cosmetic hardening: sanitize `filename` at upload anyway.)*

---

## Prioritized remediation plan

### Phase 0 — Patch now (hours, mostly `npm` + verify)
1. **H1** `npm install next@16.2.9 eslint-config-next@16.2.9` → build/test/lint.
2. **M10/M11** `npm i @clerk/nextjs@^7.3.0 && npm dedupe` → re-audit, smoke-test sign-in/org-switch.
3. Add a `package.json` `overrides` block for `fast-uri`/`uuid` → `npm install` → re-audit.
4. **H2** Lock down the CRM import upload: CSV-only + magic-byte reject + remove the `xlsx` import (or pin the SheetJS CDN build). This is the one High needing a code change.

### Phase 1 — Pattern-consistency sweep (1–2 days, copy existing in-repo patterns)
5. **FK validation** (M1–M4 + the low-tier FK gaps): add the `assert*InClient/Firm` call to plan-settings (4), entities `charityId`, withdrawal-strategy, savings-rules, liabilities PUT, entity-beneficiaries `entityIdRef`, stock-options `destinationAccountId`, sale-to-trust `trustEntityId`. Optionally add `assertExternalBeneficiariesInClient` to `db-scoping.ts`.
6. **zod parity** (M5 + lows): add `.strict()` schemas to cma-asset-classes POST, plan-settings PUT, medicare-coverage, family-members, report-comments; finite-number guard in commit/holdings; run multi-pass through `extractedPayloadSchema`.
7. **Rate-limit / audit / entitlement parity**: rate-limit + array-cap rebalance/compute (M6); audit external-beneficiaries; add the subscription/`ai_import` gate to per-file re-extract.
8. **Excel DoS** (M7): timeout race + cell budget + streaming reader in `excel-parser.ts`.

### Phase 2 — Upload/blob & hardening (2–3 days)
9. **M8/M9** private-store + authz'd download route for CRM task attachments; magic-byte + safe `contentType` on both CRM upload paths.
10. Constant-time `requireCronAuth()` helper across all 5 crons; Stripe-webhook advisory lock; csp-report body cap; billing-portal `return_url` pin.
11. Sentry PII scrubber; `Cross-Origin-Resource-Policy` header; Azure `user` tag.
12. Swap lax `getOrgId()` → `requireOrgId()`/`requireClientAccess()` on the ~15 client-detail pages; tighten `tenant-isolation.test.ts`.

### Phase 3 — Before reactivating staff roles (do *with* that feature, not before)
13. Bring `clients/search` and CRM single-household to advisor-visibility parity; validate household `advisorId` against firm membership; make `staffMaySeeAdvisor` fail-closed on unknown role; add planner-scope tests. **Gate:** these are dormant today — schedule them as a prerequisite of the `org:planner`/`org:operations` reactivation so the invariant ships *with* the roles.

### Phase 4 — Larger, standalone
14. **CSP enforcement**: nonce-based middleware CSP, drop `'unsafe-inline'/'unsafe-eval'`, flip Report-Only → enforcing once reports are clean. This is the biggest single XSS-posture upgrade and deserves its own spec.

---

## Cross-cutting recommendations

- **Add a `db-scoping` lint/test gate.** The recurring theme is *individual routes drifting from a correct
  shared pattern*. A structural test that fails when a mutating handler writes a known FK column (`accountId`,
  `modelPortfolioId*`, `entityId*`, `charityId`, `folderId`, `destinationAccountId`) without a matching
  `assert*` call would prevent regressions like M1–M4 from recurring. Pair it with the tightened
  `tenant-isolation.test.ts` (finding 40).
- **Standardize "every mutating route does zod `.strict()` + audit"** as a reviewable checklist; the
  exceptions found here (cma POST, plan-settings, medicare, family-members, report-comments,
  external-beneficiaries) are all *single* routes that missed the convention.
- **Schedule the staff-scope hardening as a hard dependency of the planner/operations reactivation.** It's
  the one place where "not exploitable today" could silently become "exploitable on a feature flag."
- **Dependency cadence:** the two Highs are both staleness. A monthly `npm audit` + Dependabot/Renovate on
  `next`/`@clerk/*` would have caught both before this audit.

*Generated 2026-06-12 from a 14-agent parallel audit with per-finding adversarial verification against the
live codebase. 51 findings → 50 confirmed (0 critical / 2 high / 11 medium / 29 low / 8 info), 1 refuted.*
