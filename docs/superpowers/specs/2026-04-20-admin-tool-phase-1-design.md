# Admin Tool — Phase 1 Design

**Date:** 2026-04-20
**Status:** Approved for implementation planning
**Scope:** Phase 1 of a multi-phase admin tool for Foundry Planning

## Summary

A separate admin web application hosted at `admin.foundry-planning.com` that lets
the founder (and, eventually, support staff) impersonate advisors to see what
their clients see, investigate issues, and perform operational tasks. Phase 1
delivers the foundations: monorepo refactor, a dedicated admin Clerk instance
with MFA + tiered roles, full read-write impersonation with SOC-2-grade audit
evidence, and the core screens needed to impersonate and audit. Client lifecycle
operations (move, restore), admin user CRUD, and DB power tools are deferred to
later phases.

## Goals

- Support staff can impersonate any advisor and perform any action the advisor
  can, with every action attributable to the real admin in an append-only audit
  log.
- The admin app is deploy-isolated from the advisor-facing app: separate Vercel
  project, separate Clerk instance, separate domain.
- SOC-2 controls in place from day one: MFA-required admin auth, tamper-evident
  audit log, least-privilege admin roles.
- The main advisor-facing app is unaware impersonation exists.

## Non-Goals (Phase 1)

- Moving clients between advisors.
- Restoring soft-deleted / archived clients.
- Admin user CRUD UI (admin users are bootstrapped manually in the Clerk
  dashboard for Phase 1).
- Consent-based or notification-based impersonation flows (impersonation is
  silent; advisors are not notified).
- Ad-hoc DB query console / data integrity dashboards.
- Migration to Postgres RLS + session-variable based enforcement (Approach 3 in
  the brainstorm).

## Architecture

### Monorepo layout

The current single-app repo is converted to a Turborepo workspace:

```
foundry-planning/
├── apps/
│   ├── web/         # existing Next.js 16 app, moved with import-path updates
│   └── admin/       # new Next.js 16 app
├── packages/
│   ├── db/          # Drizzle schema + migrations (was src/db)
│   ├── auth/        # Clerk helpers, getActingContext(), role guards
│   ├── engine/      # planning engine (was src/engine)
│   └── ui/          # shared presentational primitives
├── turbo.json
└── package.json     # npm workspaces
```

- `packages/db` is the sole owner of the Drizzle schema and migrations. Both
  apps depend on it.
- `apps/admin` deploys to a separate Vercel project on
  `admin.foundry-planning.com`.
- An ESLint boundary rule forbids `apps/web` from importing anything under
  `apps/admin` and vice versa. Shared code lives in `packages/*`.

### Authentication — two Clerk instances

- **`foundry-web`** (existing Clerk project): advisor-facing app authentication.
  Unchanged.
- **`foundry-admin`** (new Clerk project): admin-only authentication.
  - MFA required at the application level (TOTP or passkey only; SMS disabled).
  - Admin users have a `role` in Clerk `publicMetadata` ∈
    `{support, operator, superadmin}`.
  - A Clerk webhook syncs admin user events (create / update / delete) into the
    `admin_users` table in our DB. The webhook handler is idempotent and
    signature-verified. As a fallback for a missed webhook, `getActingContext()`
    lazy-creates an `admin_users` row on first successful call.

### The "acting context" primitive

`packages/auth` exports `getActingContext()`, which is called at the top of every
admin server action and route handler. It returns:

```ts
type ActingContext = {
  actorAdminId: string;                  // admin_users.id
  role: 'support' | 'operator' | 'superadmin';
  impersonation: null | {
    sessionId: string;                   // admin_impersonation_sessions.id
    advisorClerkUserId: string;
    firmId: string;
  };
};
```

Algorithm:

1. Read Clerk session → `clerkUserId`. If absent → 401.
2. Load `admin_users` row (or lazy-create if webhook hasn't fired yet). If
   `disabled_at` is set → 403.
3. Look up the most recent `admin_impersonation_sessions` row for this admin
   where `ended_at IS NULL AND expires_at > now()`. Populate `impersonation` if
   found.
4. Return context.

### Query wrapper and audit emission

`packages/db/admin-scope.ts` exports `adminQuery(ctx, fn)`, the single
DB-access path for `apps/admin`. Responsibilities:

- When `ctx.impersonation` is set, every query inside `fn` has
  `firm_id = ctx.impersonation.firmId` enforced (application-layer filter added
  to every Drizzle `where` clause that touches a firm-scoped table).
- Every mutation inside `fn` appends an `audit_log` row with
  `actor_id = ctx.actorAdminId`, `acting_as_advisor_id =
  ctx.impersonation?.advisorClerkUserId`, `impersonation_session_id =
  ctx.impersonation?.sessionId`, `action`, `resource_type`, `resource_id`, and a
  `metadata` JSON blob containing before/after values for updates.
- Any raw Drizzle import inside `apps/admin` outside this wrapper fails an
  ESLint rule.

`apps/web` does **not** use `adminQuery`; its existing DB access paths are
untouched.

## Data model changes (migration 0038)

### New tables

```sql
CREATE TABLE admin_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id text NOT NULL UNIQUE,
  email         text NOT NULL,
  role          text NOT NULL CHECK (role IN ('support','operator','superadmin')),
  created_at    timestamp NOT NULL DEFAULT now(),
  disabled_at   timestamp
);

CREATE TABLE admin_impersonation_sessions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id          uuid NOT NULL REFERENCES admin_users(id),
  advisor_clerk_user_id  text NOT NULL,
  firm_id                text NOT NULL,
  started_at             timestamp NOT NULL DEFAULT now(),
  expires_at             timestamp NOT NULL,     -- default: started_at + 30 min
  ended_at               timestamp,
  reason                 text NOT NULL
);

CREATE INDEX admin_impersonation_active_idx
  ON admin_impersonation_sessions (admin_user_id)
  WHERE ended_at IS NULL;
```

### `audit_log` extensions

```sql
ALTER TABLE audit_log
  ADD COLUMN acting_as_advisor_id      text,
  ADD COLUMN impersonation_session_id  uuid REFERENCES admin_impersonation_sessions(id),
  ADD COLUMN prev_hash                 bytea,
  ADD COLUMN row_hash                  bytea;
```

### Tamper evidence (triggers)

A `BEFORE INSERT` trigger on `audit_log` sets
`row_hash = sha256(coalesce(prev_hash, '') || canonical_json(NEW))`, where
`prev_hash` is the `row_hash` of the previous row in insert order for the same
`firm_id`. A `BEFORE UPDATE OR DELETE` trigger raises an exception — the table
is append-only at the DB layer, even for the application's DB role.

A one-shot backfill script populates `prev_hash` / `row_hash` for existing
`audit_log` rows at migration time, in insert order, partitioned by `firm_id`.

## Admin UI (Phase 1 screens)

All under `apps/admin`.

| Route | Roles | Purpose |
| --- | --- | --- |
| `/login` | — | Clerk-hosted sign-in; MFA enforced |
| `/` | all | Dashboard: your active impersonation (if any), your recent 10 audit events, quick links |
| `/advisors` | all | Searchable, paginated advisor table (name, email, firm, # clients, last activity) |
| `/advisors/[advisorId]` | all | Advisor profile + client list + "Impersonate" button (reason required) |
| `/impersonating/*` | all | Advisor UI rendered inside admin shell while impersonating; persistent red banner; full read-write |
| `/audit` | operator, superadmin | Audit log viewer with filters + CSV export |
| `/admin-users` | superadmin | Phase 1 stub; real UI deferred |

### Impersonation flow

1. Admin clicks **Impersonate** on an advisor detail page.
2. Modal requires a free-text **reason** (stored in
   `admin_impersonation_sessions.reason`).
3. On submit, a server action creates the session row
   (`expires_at = now() + 30 min`, `ended_at = NULL`) and redirects to
   `/impersonating`.
4. The `/impersonating/*` route group mounts the same page components the web
   app uses for advisors, but backed by `adminQuery(ctx, …)` data fetchers. A
   persistent red banner at the top reads *"Impersonating {advisor name} — all
   actions are logged."* with an **End session** button.
5. The admin performs any actions they need. Each mutation writes both the
   underlying data and an `audit_log` row tagged with `actor_admin_id`,
   `acting_as_advisor_id`, and `impersonation_session_id`.
6. Ending the session sets `ended_at = now()` and redirects to `/`. Expiration
   after 30 minutes has the same effect implicitly (next `getActingContext()`
   call sees no active row).

Renewing a session means starting a new one with a new reason — no extend
action.

### Shared advisor UI

The advisor pages live in `apps/web` today. To render them under
`/impersonating/*` in the admin app without duplication, they must be extracted
into `packages/ui` (presentational) with their data fetchers parameterized by
the calling app. Non-trivial; budgeted as part of the impersonation milestone
rather than the monorepo refactor.

## Testing

- `packages/auth`: unit tests for every `getActingContext()` branch — no
  session, disabled admin, missing `admin_users` row (lazy-create path),
  expired impersonation, active impersonation, role mismatch.
- `packages/db/admin-scope.ts`: integration tests against a real Neon branch
  (or Postgres test container) verifying:
  - Queries without an impersonation context cannot read firm-scoped tables.
  - Mutations write the expected `audit_log` row with both IDs and correct
    `impersonation_session_id`.
  - `audit_log` `UPDATE` and `DELETE` both raise exceptions.
  - Hash chain is continuous across a batch of inserts, including across
    multiple firms.
- `apps/admin`: component tests for the impersonation banner's visibility
  rules; Playwright smoke test covering login → pick advisor → start
  impersonation with reason → perform one write → end session → verify the
  corresponding audit row exists with all impersonation fields populated.

Test framework: existing Vitest setup. Playwright added for `apps/admin` only.

## Rollout plan

1. **Monorepo refactor** — mechanical move of files into `apps/web` +
   `packages/*`. Import path updates only, no behavior change. `apps/web`
   deploys green. Single PR.
2. **Migration 0038** — admin tables, `audit_log` columns, triggers, backfill
   script. Separate PR, deployed to staging first.
3. **`packages/auth` + `packages/db/admin-scope.ts`** — with tests.
4. **`apps/admin` scaffolding** — `/login`, `/`, `/advisors`,
   `/advisors/[advisorId]`. No impersonation yet.
5. **Impersonation** — extract advisor UI into `packages/ui`, build
   `/impersonating/*`, banner, end-session.
6. **`/audit`** viewer + CSV export.
7. **Cutover** — bootstrap one `superadmin` account (the founder) in the new
   Clerk project; configure `admin.foundry-planning.com` → Vercel.

Each step is its own PR; nothing merges to `main` without green CI. The
monorepo refactor runs in an isolated git worktree to avoid disrupting other
ongoing work.

## Risks and open questions

- **Neon connection pooling vs. future RLS.** Approach 1 doesn't use
  `SET LOCAL`, so pooling is fine today. If we later migrate to Approach 3
  (Postgres session variables + RLS), we'll need transaction-scoped
  connections — called out so we don't drift into that pattern accidentally.
- **Shared advisor UI extraction.** The advisor pages in `apps/web` may be
  tightly coupled to their auth helpers. Extracting them to `packages/ui` may
  require non-trivial refactoring. Milestone 5 owns this risk.
- **Clerk webhook reliability.** A missed webhook must not brick admin login.
  Lazy-create on first `getActingContext()` call covers this; the webhook is
  an optimization, not a correctness requirement.
- **Audit log backfill.** The one-shot backfill script must run inside a
  transaction, in deterministic order (by `created_at, id`), partitioned by
  `firm_id`. A failure halfway through must be re-runnable idempotently.
