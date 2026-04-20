# Deployment Runbook

Manual steps that cannot be automated or scripted — follow in order per plan.

---

## Plan 1 — Admin foundations (`apps/web` only)

No new Vercel project. Plan 1 ships migrations and packages only; `apps/web`
was the sole deployed surface.

**Env vars added to `foundry-web` in Plan 1:** none (Plan 1 env vars are
sourced from the existing Clerk and DATABASE_URL set).

---

## Plan 2 — Admin Vercel project + impersonation

### Prerequisites

- Plan 1's PR merged to `main`; `feature/admin-tool-plan-2` rebased onto
  `main` and green on CI.
- You have access to the Vercel dashboard (personal team or `foundry-planning`
  team) and the Clerk dashboard for both the web and admin instances.

---

### Step 1 — Generate the `IMPERSONATION_SIGNING_SECRET`

This is an HS256 signing key shared between both Vercel projects. Generate a
random 32-byte secret and base64-encode it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Keep the value — you will paste it into both Vercel projects below.

---

### Step 2 — Create the `foundry-admin` Vercel project

1. In the Vercel dashboard → **Add New… > Project**.
2. Import the **same GitHub repo** (`danmueller20/foundry-planning` or
   equivalent).
3. Set project name: **`foundry-admin`**.
4. **Framework Preset:** Next.js.
5. **Root Directory:** `apps/admin`.
6. **Node.js version:** 24.x (match `apps/web`).
7. Do **not** override the build command or output directory — Next.js defaults
   are correct.
8. Do **not** deploy yet. Continue to Step 3 first.

---

### Step 3 — Add env vars to `foundry-admin`

In the new project's **Settings > Environment Variables**, add the following.
Apply all three environments (Production, Preview, Development) unless noted.

| Variable | Value / source |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Admin Clerk instance **test** publishable key (`pk_test_…`). See Step 4. |
| `CLERK_SECRET_KEY` | Admin Clerk instance **test** secret key (`sk_test_…`). See Step 4. |
| `CLERK_WEBHOOK_SECRET` | Svix webhook signing secret from the admin Clerk webhook config. See Step 5. |
| `IMPERSONATION_SIGNING_SECRET` | Value generated in Step 1. |
| `DATABASE_URL` | Same Neon connection string used by `foundry-web` (the shared dev branch URL for Preview; prod branch URL for Production). |
| `WEB_APP_URL` | The base URL of the advisor-facing web app, e.g. `https://foundry-planning.vercel.app` (Preview) or the production domain. No trailing slash. |

> **Note:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` is embedded in the browser
> bundle. Never use a live (`pk_live_…`) key until the Plan 3 cutover.

---

### Step 4 — Create the admin Clerk instance

> The admin app requires a **separate** Clerk instance from the one used by
> `apps/web`. This is intentional — admin users are never in the advisor-side
> user pool.

1. In the Clerk dashboard → **Create application**.
2. Name it **`foundry-admin`** (or similar).
3. Authentication: email + MFA (TOTP). Disable social OAuth for the admin
   instance.
4. Copy the **Test** publishable key (`pk_test_…`) and secret key (`sk_test_…`)
   into the `foundry-admin` Vercel env vars (Step 3 above).
5. Under **Sessions**, set session lifetime to 30 min to match the
   impersonation window (optional — tighten in Plan 3 for production).

> **Plan 3 note:** Production Clerk keys (`pk_live_…` / `sk_live_…`) and the
> `admin.foundry-planning.com` domain flip are deliberately deferred to Plan 3.
> Plan 2 ships against test keys on `*.vercel.app` preview URLs.

---

### Step 5 — Configure the Clerk webhook for `foundry-admin`

1. In the **`foundry-admin`** Clerk instance → **Webhooks > Add Endpoint**.
2. **URL:** `${ADMIN_APP_URL}/api/clerk/webhook`
   - For Preview: use the `foundry-admin` Vercel preview URL, e.g.
     `https://foundry-admin-<hash>.vercel.app/api/clerk/webhook`.
   - For Production (Plan 3): `https://admin.foundry-planning.com/api/clerk/webhook`.
3. **Events to subscribe:**
   - `user.created`
   - `user.updated`
   - `user.deleted`
4. Copy the **Signing Secret** (starts with `whsec_…`) and paste it into
   `CLERK_WEBHOOK_SECRET` in `foundry-admin`'s Vercel env vars (Step 3).
5. Redeploy `foundry-admin` after setting the secret so the route handler
   picks it up.

> The webhook syncs `admin_users` rows automatically. The Plan 1 lazy-create
> fallback in `getActingContext()` remains as belt-and-braces, so the app
> works even if the webhook fires after the first admin sign-in.

---

### Step 6 — Add new env vars to `foundry-web`

In the **`foundry-web`** Vercel project → **Settings > Environment Variables**,
add:

| Variable | Value / source |
|---|---|
| `IMPERSONATION_SIGNING_SECRET` | **Same value** as set in `foundry-admin` (Step 1). The two apps share this key to sign and verify the handoff JWT. |
| `ADMIN_APP_URL` | Base URL of the admin app, e.g. `https://foundry-admin.vercel.app` (Preview) or the production domain (Plan 3). No trailing slash. |

After adding both vars, trigger a **Redeploy** on `foundry-web` (or push a
new commit — the vars take effect on the next build).

---

### Step 7 — Apply migration 0039

Migration 0039 adds `handoff_token_hash` and `handoff_consumed_at` columns to
`admin_impersonation_sessions`. Due to the known drizzle-kit ↔ Neon journal
drift (carried from Plan 1), apply manually via the Neon MCP or the Neon SQL
console:

```sql
-- 0039_impersonation_session_token_hash.sql
ALTER TABLE admin_impersonation_sessions
  ADD COLUMN IF NOT EXISTS handoff_token_hash bytea,
  ADD COLUMN IF NOT EXISTS handoff_consumed_at timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS admin_impersonation_sessions_handoff_token_hash_idx
  ON admin_impersonation_sessions (handoff_token_hash)
  WHERE handoff_token_hash IS NOT NULL;
```

Apply against both the **dev/preview branch** and **production** branch on
Neon. Then run `drizzle-kit generate` locally to keep the repo journal
coherent (even if it reports "no changes" due to the drift; the SQL file
already exists at `packages/db/drizzle/0039_...sql`).

> See FUTURE_WORK.md — "drizzle-kit ↔ Neon journal resync" — for the full
> story on why this is manual.

---

### Step 8 — First deployment and smoke test

1. Deploy `foundry-admin` from the Vercel dashboard (or push to the branch
   that maps to the `foundry-admin` project's preview).
2. Navigate to the `foundry-admin` preview URL. You should see the Clerk
   sign-in page.
3. Sign in with the admin Clerk test account (create one in the Clerk
   dashboard if needed — admin users are not advisors).
4. Confirm the dashboard loads and shows "No active impersonation session."
5. Navigate to `/advisors` and confirm the advisor list renders.
6. Confirm the Clerk webhook fires on the test sign-in by checking
   `/audit` → look for a `admin_user.created` or `admin_user.updated` row.

> **Playwright E2E** (Task 19) exercises the full impersonation happy-path
> across both preview deployments. That test requires real preview URLs and
> seeded test credentials — run it manually after Step 8 succeeds.
> See `apps/admin/tests/impersonation.spec.ts`.

---

### Post-deploy verification matrix (manual)

| # | Check | Expected |
|---|---|---|
| 1 | Sign in to admin app | Clerk sign-in page → dashboard |
| 2 | `/advisors` | Advisor list renders with search |
| 3 | Impersonate an advisor | Red banner visible on `apps/web /clients` |
| 4 | Mutate a client field while impersonating | Mutation succeeds; audit row written with `actor_admin_id` |
| 5 | End session via banner | Redirects to `foundry-admin` dashboard |
| 6 | `/audit` in admin app | Rows for `impersonation.start`, `client.update`, `impersonation.end` |
| 7 | Filter audit by session id | Only rows for that session shown |
| 8 | CSV export | Downloads a valid CSV with same rows |
| 9 | Replay handoff URL after consumption | 401 |
| 10 | Session expiry (30 min) | Cookie cleared; lands on Clerk sign-in |

---

## Plan 3 — Production cutover (future)

Steps to complete in Plan 3 — **do not perform during Plan 2**:

- Create production Clerk instances for both `apps/web` and `apps/admin`,
  rotate `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` in both
  Vercel projects to `pk_live_…` / `sk_live_…`.
- Add custom domain `admin.foundry-planning.com` to the `foundry-admin`
  Vercel project.
- Update `WEB_APP_URL` in `foundry-admin` and `ADMIN_APP_URL` in
  `foundry-web` to production domains.
- Update the Clerk webhook URL in the admin Clerk instance to
  `https://admin.foundry-planning.com/api/clerk/webhook`.
- Rotate `IMPERSONATION_SIGNING_SECRET` to a new production value (the
  test-env key should not be used in production).
