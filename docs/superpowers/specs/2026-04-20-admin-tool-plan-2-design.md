# Admin Tool — Plan 2 Design (Admin shell + impersonation)

**Date:** 2026-04-20
**Status:** Approved for implementation planning
**Scope:** Plan 2 of 3 — admin Next.js app, cross-app impersonation, audit viewer
**Builds on:** Plan 1 foundations (shipped 2026-04-20, PR #2) and the Phase 1
design at `docs/superpowers/specs/2026-04-20-admin-tool-phase-1-design.md`.

This document narrows and refines the Plan 2 portion of the Phase 1 design. A
few decisions here deviate from the original spec (notably the impersonation
architecture); those deltas are called out inline.

## Summary

Ship the admin Next.js app at `apps/admin` and the runtime plumbing that lets a
signed-in admin impersonate an advisor in the existing advisor-facing app.
Impersonation is rendered by `apps/web` — not by `apps/admin` — using a
short-lived signed JWT handoff and a scoped cookie. Every mutation made while
impersonating is logged to `audit_log` with the impersonation session id and
the actor admin id. A phase-1 `/audit` viewer ships in `apps/admin` so the
founder can inspect the trail end-to-end. Production Clerk rollout and the
`admin.foundry-planning.com` DNS flip are Plan 3 cutover work.

## Goals

- Admin can impersonate any advisor with one click + a reason, perform real
  read-write actions as that advisor, and end the session at any time.
- Every impersonation-scoped mutation writes an `audit_log` row with
  `actor_admin_id`, `acting_as_advisor_id`, and `impersonation_session_id`.
- `apps/admin` deploys to its own Vercel project with its own Clerk instance.
- Founder can browse, filter, and CSV-export the audit log.
- Plan 2 is shippable onto a `feature/admin-tool-plan-2` branch that rebases
  cleanly onto `main` after Plan 1's PR #2 merges.

## Non-Goals

- Admin user CRUD UI (`/admin-users`).
- Client lifecycle operations (move advisor, restore soft-deleted).
- DB power tools / ad-hoc query console.
- Hash-chain verification UI / background verifier (the chain itself is
  already tamper-evident at the DB layer — Plan 1 ships the triggers and
  integration test).
- Production admin Clerk provisioning + `admin.foundry-planning.com` domain
  flip. Plan 2 ships against `pk_test_…` admin keys on `*.vercel.app` preview
  URLs, matching the pattern `apps/web` uses today.
- Moving to `@neondatabase/serverless` Pool for mutation+audit atomicity.
  Documented gap carried forward from Plan 1.
- Audit-coverage sweep for low-risk mutation endpoints (entities,
  family-members, etc.). Plan 2 covers the high-risk set; the rest stays in
  FUTURE_WORK.

## Architectural decision — deviates from Phase 1 spec

The Phase 1 design described impersonation as rendered *inside* `apps/admin`
under `/impersonating/*`, backed by `adminQuery()` data fetchers with the
advisor UI extracted into `packages/ui`. We are not taking that approach.

**Plan 2 approach:** impersonation runs on `apps/web`. `apps/admin`'s
"Impersonate" action mints a short-lived signed JWT and 302s the browser to a
handoff endpoint on `apps/web`. `apps/web` sets an HttpOnly cookie scoped to
its own origin; its middleware resolves the cookie on every request and
populates an `AdvisorContext` in AsyncLocalStorage so the existing firm-id
resolver transparently returns the advisor's firm. The persistent red banner
and "End session" button render in `apps/web`'s root layout when the context
is impersonated.

**Why the deviation:** the original approach required extracting every
advisor-facing page (cashflow, balance sheet, reports, timeline, Monte Carlo,
all Client Data forms) into `packages/ui` before Plan 2 could usefully
impersonate. That's a sprawling refactor with a long tail of UI regressions.
Routing the admin into `apps/web` reuses the UI that already works and is
tested; the trade-off is that `apps/web` is now impersonation-aware (the
Phase 1 non-goal "main advisor-facing app is unaware impersonation exists"
is relaxed accordingly).

**Invariant preserved:** the DB row in `admin_impersonation_sessions` is the
sole authority on whether a session is active. The web-side cookie is a
pointer. `ended_at` / `expires_at` is checked on every request.

## Impersonation lifecycle

```
admin clicks Impersonate (apps/admin /advisors/[advisorId])
  ↓ modal captures free-text reason
apps/admin server action /api/impersonation/start:
  INSERT admin_impersonation_sessions
    (admin_user_id, advisor_clerk_user_id, firm_id, reason,
     expires_at = now() + 30 min,
     handoff_token_hash)
  writeAuditLog { action: 'impersonation.start', session_id }
  mint JWT (HS256, 60s exp): { sessionId, actorAdminId, advisorClerkUserId, firmId }
  302 → ${WEB_APP_URL}/api/impersonation/handoff?t=<jwt>

apps/web /api/impersonation/handoff:
  verifyImpersonationToken(jwt)
  consumeHandoffToken(sha256(jwt))     ← CAS on handoff_consumed_at
    if already consumed OR session ended/expired → 401
  Set-Cookie: foundry_impersonation=<sessionId>
    HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1800
  302 → /clients

apps/web middleware (every request, wraps Clerk middleware):
  cookie = req.cookies.get('foundry_impersonation')
  if cookie:
    session = sessionRepo.loadActive(cookie.value)
    if !session: clear cookie, proceed as normal advisor
    else: runWithAdvisorContext({ kind: 'impersonated', ... }, next)
  else:
    proceed (normal advisor; getAdvisorContext() resolves from Clerk on demand)

apps/web firm-id resolver:
  ctx = await getAdvisorContext()
  return ctx.firmId   // advisor's own firm OR impersonated advisor's firm

apps/web mutation callsites (high-risk set):
  auditedMutation({ action, resource_type, resource_id, metadata }, async () => {
    …existing mutation…
  })
  helper writes audit_log after mutation when ctx.kind === 'impersonated'

admin clicks "End session" in banner:
  POST apps/web /api/impersonation/end
    assert ctx.kind === 'impersonated'
    sessionRepo.end(ctx.sessionId)           // sets ended_at = now()
    writeAuditLog { action: 'impersonation.end', session_id }
    clear cookie
    302 → ${ADMIN_APP_URL}/
```

Expiration (30 min) has the same effect as End implicitly: the next request's
`sessionRepo.loadActive` returns null, middleware clears the cookie, and the
advisor context falls back to Clerk (i.e., the admin's own advisor-side
session, which does not exist — so they land on Clerk sign-in). Renewal is
not supported; admins start a fresh session with a fresh reason.

## Data model

Plan 2 adds **migration 0039** — one schema change:

```sql
-- 0039_impersonation_session_token_hash.sql
ALTER TABLE admin_impersonation_sessions
  ADD COLUMN handoff_token_hash bytea,
  ADD COLUMN handoff_consumed_at timestamp;

CREATE UNIQUE INDEX admin_impersonation_sessions_handoff_token_hash_idx
  ON admin_impersonation_sessions (handoff_token_hash)
  WHERE handoff_token_hash IS NOT NULL;
```

Why: the handoff JWT is a one-shot capability. Persisting `sha256(jwt)` lets
the handoff endpoint compare-and-swap on `handoff_consumed_at` to reject
replays even if the redirect URL is captured from logs or browser history.
Without this, replay defense is purely the 60s JWT `exp`, which is weaker
than the rest of the SOC-2 posture. `handoff_consumed_at` is left in place
after consumption as forensic evidence; the column is never cleared.

No other schema changes. Plan 1 already created `admin_users`,
`admin_impersonation_sessions`, and the extended `audit_log`.

**Drizzle-kit caveat (carried from Plan 1):** the repo journal and Neon's
`__drizzle_migrations` bookkeeping are out of sync on both the `production`
and `admin-tool-plan-1` branches. Plan 2 will run `drizzle-kit generate` for
0039 (to keep the journal coherent) *and* apply the SQL manually via the Neon
MCP tool on the dev branch, surfacing the drift to the implementer.
Resynchronizing drizzle-kit state is a separate FUTURE_WORK item.

## Package API additions

### `@foundry/auth` — new exports

```ts
// Impersonation token utilities
export function signImpersonationToken(claims: {
  sessionId: string;
  actorAdminId: string;
  advisorClerkUserId: string;
  firmId: string;
}): { token: string; tokenHash: Buffer };             // HS256, 60s exp

export function verifyImpersonationToken(token: string): Claims;
export function hashImpersonationToken(token: string): Buffer;

// Advisor-side context (distinct from admin ActingContext)
export type AdvisorContext =
  | { kind: 'advisor';     clerkUserId: string; firmId: string }
  | { kind: 'impersonated'; clerkUserId: string; firmId: string;
                            actorAdminId: string; sessionId: string;
                            role: AdminRole };

export function getAdvisorContext(): Promise<AdvisorContext>;
export function runWithAdvisorContext<T>(
  ctx: AdvisorContext,
  fn: () => Promise<T>
): Promise<T>;

// Repository contract (Drizzle impl lives in @foundry/db)
export interface ImpersonationSessionRepo {
  loadActive(sessionId: string): Promise<ActiveSession | null>;
  consumeHandoffToken(tokenHash: Buffer): Promise<ActiveSession | null>;
  end(sessionId: string): Promise<void>;
}

// Clerk webhook helper (framework-agnostic)
export function handleClerkAdminWebhook(
  req: Request,
  repo: AdminUserRepo,
  signingSecret: string
): Promise<Response>;                                 // svix-signed
```

`AdvisorContext` is deliberately distinct from the admin `ActingContext`
shipped in Plan 1. Two different consumers (`apps/web` vs `apps/admin`), two
different type names, no accidental cross-wiring.

### `@foundry/db` — new surface

```ts
// Drizzle implementation of the repo
export function drizzleImpersonationSessionRepo(db: DB): ImpersonationSessionRepo;

// Mutation-site helper — apps/web consumers wrap DB writes with this
export async function auditedMutation<T>(
  entry: Omit<AuditLogEntry, 'actorAdminId' | 'sessionId' | 'firmId'>,
  run: () => Promise<T>
): Promise<T>;
```

### `@foundry/ui` — first real export

```ts
export { ImpersonationBanner } from './impersonation-banner';
```

Presentational only — red bar at top, advisor name, "End session" button that
POSTs a parameterised endpoint. No data fetching in the component itself.

## `apps/web` integration

### Middleware composition

`apps/web` uses Clerk middleware today. Plan 2 wraps it:

```ts
export default clerkMiddleware(async (auth, req) => {
  const cookie = req.cookies.get('foundry_impersonation');
  if (cookie) {
    const session = await sessionRepo.loadActive(cookie.value);
    if (!session) {
      const res = NextResponse.next();
      res.cookies.delete('foundry_impersonation');
      return res;
    }
    return runWithAdvisorContext(
      { kind: 'impersonated', ...toAdvisorContext(session) },
      () => NextResponse.next()
    );
  }
  // normal advisor flow
});
```

**Runtime pinning.** Next.js middleware defaults to the edge runtime; ALS
propagation requires Node.js. The plan pins this middleware to `runtime:
'nodejs'`. If that turns out unworkable under Next 16, the fallback is:
middleware attaches `x-impersonation-session-id` as a request header, and
`getAdvisorContext()` reads the header at the server-action / route-handler
layer. Plan will prototype the primary path in step 3.1 and fall back only
if blocked.

### Firm-id resolver

The canonical firm-id resolver in `apps/web` gains a single branch:

```ts
const ctx = await getAdvisorContext();
return ctx.firmId;  // advisor's own firm OR impersonated advisor's firm
```

Every existing callsite keeps working. The tenant-isolation contract test
(`src/__tests__/tenant-isolation.test.ts`) still passes unchanged.

### Audit coverage scope

`auditedMutation` wraps the high-risk mutation set only in Plan 2:

- `clients` — create / update / delete
- `accounts` — create / update / delete
- `liabilities` — create / update / delete
- `plan_settings` — update
- `incomes` — create / update / delete
- `expenses` — create / update / delete
- `client_deductions` — create / update / delete
- `savings_rules` — create / update / delete
- `transfers` — create / update / delete
- `asset_transactions` — create / update / delete

Everything else (entities, family-members, misc read-side helpers) stays in
FUTURE_WORK. The rationale matches the security-hardening retro: the
high-risk set is what a hostile impersonation session could actually damage;
full coverage is belt-and-braces.

### Banner + end-session

- `<ImpersonationBanner />` renders conditionally in `apps/web`'s root
  layout based on `getAdvisorContext()`.
- "End session" button POSTs `/api/impersonation/end`:
  1. Assert context is impersonated.
  2. `sessionRepo.end(ctx.sessionId)`.
  3. `writeAuditLog({ action: 'impersonation.end', session_id: ctx.sessionId })`.
  4. Clear cookie.
  5. 302 to `${ADMIN_APP_URL}/`.

## `apps/admin` shape

### Routes

| Route | Roles | Purpose |
|---|---|---|
| `/login` | — | Clerk-hosted sign-in (admin Clerk instance, MFA enforced at Clerk config) |
| `/` | all | Dashboard: active impersonation if any, recent 10 audit events, quick search |
| `/advisors` | all | Searchable, paginated advisor table |
| `/advisors/[advisorId]` | all | Advisor profile, client list, Impersonate button (reason modal) |
| `/audit` | operator, superadmin | Audit log table + filters + CSV export |
| `/audit/sessions/[id]` | operator, superadmin | All rows tagged with a specific `impersonation_session_id` |
| `/api/impersonation/start` | all (server action) | Create session row, mint JWT, 302 to web handoff |
| `/api/clerk/webhook` | public (svix-signed) | Sync admin user events → `admin_users` |

### Explicitly not in `apps/admin`

- `/impersonating/*` route group (see architectural decision above).
- Advisor UI imports. `apps/admin` never renders cashflow, balance sheet,
  reports, forms, etc.
- `/admin-users` UI (Phase 1 non-goal; Plan 3).

### Data access

Every route and server action calls the existing `getActingContext()`
(Plan 1) and uses `adminQuery()` for DB access. `writeAuditLog` is called
for `impersonation.start` on session creation; `impersonation.end` is
written by `apps/web` because the End button physically lives there.

### `/audit` viewer

- Server-rendered table of `audit_log` rows. Columns: timestamp, actor
  admin email, acting-as advisor (if set), action, resource_type,
  resource_id, impersonation session id (linkified to
  `/audit/sessions/[id]`).
- Filters via query params: `actor`, `advisor`, `from`, `to`, `action`.
  Server-side, no client-side state.
- CSV export: `GET /audit/export?...` streams a CSV response with the same
  filters. Same role guard.
- **No tamper-evidence UI.** The hash chain is a DB-layer property; a
  "verify chain" button / background verifier is FUTURE_WORK.

### Clerk webhook

`apps/admin/src/app/api/clerk/webhook/route.ts` — thin wrapper around
`handleClerkAdminWebhook()` from `@foundry/auth`. Svix signature
verification, idempotent on event id, handles `user.created`,
`user.updated`, `user.deleted`. The Plan 1 lazy-create fallback in
`getActingContext()` stays in place as belt-and-braces.

### Vercel project + environment variables

Separate Vercel project `foundry-admin`. New env vars:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` — admin Clerk test key
- `CLERK_SECRET_KEY` — admin Clerk test key
- `CLERK_WEBHOOK_SECRET` — svix secret for the admin Clerk webhook
- `IMPERSONATION_SIGNING_SECRET` — HS256 key, **shared between
  `foundry-admin` and `foundry-web`**
- `DATABASE_URL` — same Neon branch as `foundry-web` in Plan 2
- `WEB_APP_URL` — `foundry-web` deployment URL (used to build the handoff
  redirect)

`foundry-web` also gets `IMPERSONATION_SIGNING_SECRET` and `ADMIN_APP_URL`
(used to redirect after End session).

## Testing

### `@foundry/auth` unit tests (no DB)

- Token round-trip: signed / verified round-trip; expired rejected; wrong
  secret rejected; tampered claims rejected; `hashImpersonationToken` is
  stable `sha256(token)`.
- `getAdvisorContext`: returns normal advisor when ALS not set; returns
  impersonated when set; throws `AdminAuthError` on internally
  inconsistent contexts.
- `handleClerkAdminWebhook`: valid svix signature → repo call; invalid
  signature → 401; replay of same event id → idempotent (no double write);
  all three event types dispatch to the right repo method.

### `@foundry/db` integration tests (live Neon branch)

- `consumeHandoffToken`: first call succeeds and sets
  `handoff_consumed_at`; second call with same hash returns null.
  Concurrent calls: exactly one wins (replay-resistance).
- `loadActive`: returns row when `ended_at IS NULL AND expires_at > now()`;
  null when ended; null when expired.
- `end`: sets `ended_at`; subsequent `loadActive` returns null.

### `apps/admin` tests

- `/api/impersonation/start` server-action test: given valid admin context
  and advisor id, writes the session row with expected fields, returns a
  redirect URL whose JWT hash matches the stored `handoff_token_hash`.
- `/audit` component test with fixture rows.
- Clerk webhook route integration test.

### `apps/web` tests

- `/api/impersonation/handoff`:
  - Valid JWT + unconsumed hash → sets cookie, 302, `handoff_consumed_at`
    now set.
  - Valid JWT + already-consumed hash → 401, no cookie.
  - Expired JWT → 401.
  - JWT whose `sessionId` has `ended_at` → 401.
- Middleware: cookie + active session → request runs with impersonated
  context (debug route echoes `getAdvisorContext()`); cookie + ended
  session → cookie cleared, proceeds as normal advisor.
- Firm-id resolver: returns own firm normally, advisor's firm when
  impersonated.
- `auditedMutation` helper: runs inner fn, writes audit row only when
  impersonated, attaches `sessionId` + `actorAdminId`.

### End-to-end (Playwright, spans both preview deployments)

One happy-path test:

1. Sign in as seeded admin (admin Clerk test instance).
2. Navigate `/advisors` → `/advisors/[seed-advisor-id]`.
3. Click Impersonate, enter reason.
4. Expect browser lands on web app `/clients` with red banner visible.
5. Edit a known client field (mutation path).
6. Click "End session" in banner.
7. Expect browser lands on admin dashboard.
8. Navigate `/audit`, filter by the session id shown on dashboard.
9. Assert rows: `impersonation.start`, `client.update`, `impersonation.end`.
10. Assert `client.update` row's metadata contains before/after values.

Covers JWT handoff, cookie plumbing, middleware ALS propagation, firm-id
resolver override, `auditedMutation` emission, hash-chain append,
end-session flow, audit viewer rendering.

### Test data

A seed script in `packages/db/src/test-fixtures.ts` creates: one admin
user, one advisor (normal Clerk user in web test instance), one client.
Same fixture serves the Playwright run.

### What's NOT tested in Plan 2

- Hash-chain verification (covered by Plan 1's integration test).
- Multi-firm bleed (covered by `src/__tests__/tenant-isolation.test.ts`
  plus the firm-id resolver test).
- Load / concurrency beyond the handoff-token race.

## Rollout (in-plan)

Each step is a single PR, merges only on green CI. All work on
`feature/admin-tool-plan-2`, branched from `feature/admin-tool-foundations`
until PR #2 merges, then rebased onto `main`.

1. Migration 0039 (handoff token hash columns). Harmless to `apps/web`.
2. `@foundry/auth` additions + Drizzle repo impls in `@foundry/db`. Unit +
   integration tests. No app consumers yet.
3. `apps/web` integration:
   3.1 Prototype middleware ALS under Next 16 `runtime: 'nodejs'`. If
       blocked, switch to header-based fallback and document.
   3.2 Firm-id resolver branch + `getAdvisorContext()` wiring.
   3.3 `auditedMutation` helper applied to the high-risk mutation set.
   3.4 `/api/impersonation/handoff`, `/api/impersonation/end`.
   3.5 `<ImpersonationBanner />` in root layout.
4. `apps/admin` scaffolding: Vercel project, env, Clerk test instance,
   `/login`, `/`, `/advisors`, `/advisors/[id]`, `/api/impersonation/start`,
   `/api/clerk/webhook`. Deploys to preview.
5. `/audit` viewer + `/audit/sessions/[id]` + CSV export.
6. Playwright end-to-end across both preview deployments; wire into CI.

## Risks

- **Node.js middleware runtime in Next 16.** If ALS propagation isn't
  reliable, fallback is header-based context lookup at the server-action
  layer. Plan step 3.1 resolves this before wider wrapping.
- **Clerk dual-instance cookie collisions in preview.** Both preview apps
  live on `*.vercel.app` (shared eTLD+1); each Clerk instance must use a
  distinct cookie name. Verification task, not design.
- **Cross-origin cookie set via `SameSite=Lax`.** Top-level navigation from
  admin → web handoff is Lax-permitted because the cookie is being set by
  the response, not read across origins. Worth a browser smoke test on
  day one.
- **Audit coverage drift.** New mutation endpoints added later won't
  automatically be wrapped. Proposed ESLint rule forcing `auditedMutation`
  on `apps/web/src/app/api/**` writes is deferred to Plan 3 / FUTURE_WORK.
- **neon-http atomicity gap.** Mutation + audit-write across two
  statements. Carried from Plan 1, not addressed here. WebSocket Pool
  promotion is its own spec.
- **Drizzle-kit ↔ Neon journal drift.** Plan 1 applied 0037/0038
  manually via Neon MCP; Plan 2 repeats the pattern for 0039. Full
  resync is a FUTURE_WORK item.

## Open items tracked to FUTURE_WORK

Added as part of Plan 2's merge:

- Audit-coverage sweep for low-risk mutations (entities, family-members,
  deductions, transfers, asset-transactions, savings-rules).
- ESLint rule forcing mutations through `auditedMutation`.
- Audit-chain verification UI / background verifier.
- Session renewal UX (today: 30 min expiry, admin starts a fresh session).
- WebSocket Pool migration for mutation+audit atomicity.
- Prod admin Clerk instance + `admin.foundry-planning.com` DNS (Plan 3
  cutover).
- `/admin-users` UI (Plan 3).
- Drizzle-kit ↔ Neon journal full resync.
- Client move / restore / DB power tools (Phase 2).
