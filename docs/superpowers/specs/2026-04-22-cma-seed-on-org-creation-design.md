# CMA Seed on Org Creation — Design

**Date:** 2026-04-22
**Status:** Approved for implementation planning
**Scope:** Auto-seed default CMAs (asset classes, model portfolios, correlations) for every new Clerk org, reliably, so advisors never see an empty `/cma` page

## Summary

Replace the current single-path lazy-seed mechanism (POST `/api/cma/seed` on `/cma` page mount, failures silently swallowed) with a layered-defense architecture. A shared idempotent helper `seedCmaForFirm(firmId)` is the single source of truth; three independent paths invoke it so the seed effectively always runs: an inline call in the production signup handler, a Clerk `organization.created` webhook, and a lazy fallback on the `/cma` page with loud error surfacing. The existing admin-triggered reseed endpoint is retained for operational recovery.

## Motivation

Foundry Planning is about to move from solo-dev mode into production onboarding. Every advisor's firm needs the 14 default asset classes, 4 model portfolios, and 78 pairwise correlations seeded before they touch any client work — otherwise Monte Carlo projections, allocation UIs, and portfolio tooling all break.

The current mechanism works in theory but fails silently in practice:

- `/cma` page mounts → POST `/api/cma/seed` → doesn't check `res.ok` ([src/app/(app)/cma/cma-client.tsx:59](../../../src/app/(app)/cma/cma-client.tsx#L59)).
- Seed requires `org:admin`. Any role mismatch, transient DB error, or handler bug returns 4xx/5xx, is swallowed, and the UI shows an empty CMA page with no indication anything went wrong.
- A debugging session on 2026-04-22 exposed this: a new Clerk org had zero CMAs and no error surface told anyone why.

"Eventually it'll work" is not acceptable for a paying advisor's first login. The system needs multiple independent triggers that all invoke the same idempotent helper, so a failure in any one layer is caught by the next.

## Current State

| Component | Current behavior | Problem |
|---|---|---|
| `/api/cma/seed` (POST, admin-only) | Inserts defaults, idempotent via `ON CONFLICT DO NOTHING` | Only triggered by UI mount; requires `org:admin` |
| `/cma` client | Awaits seed POST, doesn't check response | Swallows all non-ok responses silently |
| Clerk webhooks | None configured | Org creation is invisible to the app |
| Signup flow | None — orgs created via Clerk's `<OrganizationList/>` | No hook point for server-side seeding in prod |

## Goals

- Every new Clerk org receives the default CMAs within the same request that creates it (inline path) or the next processing of the `organization.created` webhook (fallback path), so advisors never see an empty `/cma`.
- All triggers share one idempotent helper — seed cannot duplicate, corrupt, or partially apply data.
- Webhook endpoint is signature-verified and replay-safe.
- Failures surface loudly: server logs, audit-log entries, and a visible UI banner when the lazy path hits an error.
- Existing `/api/cma/seed` continues to work as a manual admin retrigger for ops.

## Non-Goals

- Changing the content of `DEFAULT_ASSET_CLASSES` / `DEFAULT_MODEL_PORTFOLIOS` / `DEFAULT_CORRELATIONS`. The defaults themselves stay in [src/lib/cma-seed.ts](../../../src/lib/cma-seed.ts).
- Per-advisor customization, CMA versioning, or CMA-update propagation. New orgs get today's defaults; later edits stay scoped to that org.
- Building the production signup form itself. This spec reserves the inline hook point but the form is a separate feature. Until the form exists, webhook is the primary path.
- Backfilling CMAs for orgs that already exist in local dev. The 2026-04-22 debug session cleaned those up; going forward, all new orgs flow through the new paths.
- Multi-tenant role model changes. `org:admin` / `org:member` semantics unchanged.

## Architecture

### Layer 0 — Shared idempotent helper

New file: `src/lib/cma-seed-runner.ts`

```ts
export async function seedCmaForFirm(firmId: string): Promise<SeedResult> {
  // Inline version of the current POST /api/cma/seed body:
  // 1. Insert DEFAULT_ASSET_CLASSES ON CONFLICT DO NOTHING
  // 2. Re-fetch asset classes to build name→id map
  // 3. Insert DEFAULT_MODEL_PORTFOLIOS ON CONFLICT DO NOTHING
  // 4. Insert allocations per portfolio, gated on "portfolio has no allocations"
  // 5. Insert DEFAULT_CORRELATIONS via canonicalPair, gated on "firm has no correlations"
  // Return {assetClasses, portfolios, correlations} counts for logging/auditing.
}

export type SeedResult = {
  assetClasses: number;
  portfolios: number;
  correlations: number;
};
```

No auth checks inside the helper — it trusts its caller. Every invocation is safe to repeat: all inserts are guarded by `ON CONFLICT DO NOTHING` or by existence checks.

`POST /api/cma/seed`, the Clerk webhook, the inline signup call, and the lazy fallback all call this single function. The existing route handler shrinks to: auth gate → `await seedCmaForFirm(firmId)` → audit → response.

### Layer 1 — Inline seed in the signup handler (production primary path)

When the production signup form is built, its server action / route handler will:

1. Validate advisor input.
2. Call Clerk's backend API to create the organization.
3. **Immediately call `seedCmaForFirm(newOrg.id)` in-process.**
4. On success, redirect to `/clients`.
5. On seed failure: log, audit, and either (a) surface the error to the signup UI and let the user retry, or (b) continue — the webhook and lazy paths will catch it. Choice is an implementation detail for the signup feature; the helper contract supports both.

Reliability gain: this path has no network hop after org creation. If the signup handler runs at all and Clerk returns a new org, the seed runs microseconds later in the same server process. The only failure mode is a thrown DB error, which the handler sees synchronously.

This spec does not build the signup form. It defines the helper contract so the form's author has a single obvious call site.

### Layer 2 — Clerk `organization.created` webhook (covers manual creation)

New file: `src/app/api/webhooks/clerk/route.ts`

- Verifies Svix signature headers (`svix-id`, `svix-timestamp`, `svix-signature`) against `CLERK_WEBHOOK_SECRET`. Request body read as raw text (not JSON) before verification.
- On verified `organization.created` event: extract `data.id`, call `seedCmaForFirm(data.id)`, record an audit entry with `action: "cma.seed"` and `actorId: "clerk:webhook"`, return 200.
- On any other event type: return 200 without action (future-proof against Clerk adding events we don't care about).
- On signature mismatch: 401, do not call seed.
- On seed throw: return 500 so Clerk retries. Clerk retries failed webhooks with exponential backoff for ~24 hours; since the helper is idempotent, retries are safe.

Route is declared `public` in middleware (bypasses Clerk auth — it's an inbound webhook).

### Layer 3 — Lazy `/cma` safety net (with loud failure surfacing)

Existing behavior is kept but hardened:

1. `/cma` client-side fetch sequence unchanged: POST `/api/cma/seed` then GET the two list endpoints.
2. **The seed POST's response is now checked.** If not ok, capture `status` and `body.error` and display a dismissible banner above the CMA tables: *"We couldn't set up your default capital-market assumptions. [Retry]. If this persists, contact support."*
3. Retry button re-invokes the same seed POST.
4. Successful seed with `seeded: true` and non-zero counts is a signal that a prior layer failed — log this server-side as a warning (`[cma.seed] lazy path caught missing-seed for firm <id>`) so the team knows the webhook or inline layer missed.

### Layer 4 — Admin manual reseed (retained)

`POST /api/cma/seed` stays exactly as it is today, now a thin wrapper around the shared helper. Useful for:

- Re-running seed after editing `DEFAULT_*` constants in code and wanting specific firms updated (manual, one firm at a time — bulk updates are out of scope).
- Ops recovery if all three automated layers failed.

## Data flow

### Happy path (production signup — Layer 1 primary)

```
Advisor → Signup form → POST /api/signup
                          ├─ Clerk API: create org
                          ├─ seedCmaForFirm(newOrg.id)  ← all three tables populated
                          ├─ recordAudit(cma.seed, actor = advisor)
                          └─ redirect → /clients  ← CMA-ready
```

### Admin-dashboard path (Layer 2 — manual org creation fallback)

```
You → Clerk dashboard → create org
                          ↓
Clerk → POST /api/webhooks/clerk (signed)
         ├─ verify signature
         ├─ dispatch organization.created
         ├─ seedCmaForFirm(data.id)
         ├─ recordAudit(cma.seed, actor = "clerk:webhook")
         └─ 200
```

### Recovery path (Layer 3 — lazy catch)

```
Advisor → /cma
  ├─ POST /api/cma/seed  ← helper is idempotent; inserts anything missing
  │   ├─ ok → render list
  │   └─ not ok → banner + retry button + server warning log
  └─ GET list endpoints
```

## Error handling & observability

- **Audit log entries** for every seed invocation regardless of trigger path, with `actorId` identifying the path: advisor user id (Layer 1), `"clerk:webhook"` (Layer 2), advisor user id (Layer 3), admin user id (Layer 4). Metadata carries `SeedResult` counts.
- **Structured server logs** with `[cma.seed]` prefix on every invocation and every failure. Log Layer 3 success as a warning because it indicates a prior-layer miss.
- **UI error surface** only on the lazy path — the only path the advisor directly drives. Other paths surface via logs and audit.
- **No dead-letter queue / manual replay infra.** Clerk's built-in webhook retry window (~24h) plus Layer 3 + Layer 4 cover the surface.

## Security

- `CLERK_WEBHOOK_SECRET` stored in Vercel env (per-environment), pulled locally via `vercel env pull` per [AGENTS.md](../../../AGENTS.md). Never logged, never returned in responses.
- Webhook verifier uses Svix's `Webhook` class (bundled with `@clerk/nextjs` or installed separately as `svix`) — no hand-rolled HMAC.
- Webhook endpoint is rate-limited via existing Upstash infrastructure to 60 rpm per source IP. Legitimate Clerk traffic is well under this; the gate is only to blunt credential-stuffing of the endpoint.
- `/api/webhooks/clerk` added to the public-route matcher in [src/middleware.ts](../../../src/middleware.ts) so Clerk auth doesn't interfere with the inbound signed request.
- `seedCmaForFirm()` takes a raw `firmId` string — callers must not pass user-controlled input. All three internal callers derive `firmId` from trusted sources (authed session orgId, signed webhook payload, or authed admin session).

## Testing strategy

- **Unit tests** for `seedCmaForFirm()` against a Neon test branch: empty firm, already-seeded firm (idempotence), partial state (asset classes present but no portfolios), unknown asset classes in correlations (tolerated, skipped).
- **Webhook-handler tests**: valid signed `organization.created` → seed runs; invalid signature → 401; unknown event type → 200 no-op; malformed payload → 400; seed helper throw → 500.
- **UI test** for `/cma` lazy path: mock seed POST → 403 → banner appears with retry button; successful retry clears banner.
- **End-to-end manual test** per [vercel:verification](../../../AGENTS.md) skill: create a fresh Clerk org via the dashboard, observe the webhook fire in Clerk's dashboard webhook log, verify CMA rows appear, visit `/cma` and confirm no warning log.
- **Test doubles:** the helper is pure Drizzle + defaults — tests hit a real Neon test branch rather than mocking the DB (per the project's "no mock DB for integration tests" convention in [AGENTS.md](../../../AGENTS.md)).

## Rollout plan

This is an additive feature with zero schema changes:

1. Add `CLERK_WEBHOOK_SECRET` to Vercel env for preview and prod.
2. Merge code: helper, webhook route, UI banner, refactored `/api/cma/seed`.
3. In Clerk dashboard, add a webhook endpoint pointing at `https://<prod-domain>/api/webhooks/clerk`, subscribed to `organization.created`. Copy signing secret into Vercel env.
4. Smoke test by creating a throwaway org in the Clerk dashboard → verify CMA rows land + audit entry records the webhook actor.
5. When the signup form is built later, its author adds the Layer 1 inline call.

Rollback: remove the webhook in the Clerk dashboard (Layer 2 goes inert), revert the UI banner (Layer 3 reverts to silent-swallow — not preferred, but safe). The helper and admin endpoint remain functional.

## Open questions

- **Signup form ownership**: who writes the Layer 1 inline call — this feature, or the separate signup-form feature? Current answer: the signup-form feature. This spec ships Layers 0, 2, 3, 4.
- **Webhook idempotency across retries**: if Clerk retries a webhook 3x before succeeding, we get 3 audit entries. Acceptable? Alternative is a `(firm_id, action)` unique check in audit before inserting. Current answer: accept the extra audit rows; they correctly reflect reality.
- **Local dev webhook testing**: Clerk can't reach `localhost` directly. Options are `ngrok`, Clerk's forwarding tool, or relying on Layer 3 in dev and only exercising Layer 2 in preview/prod. Current answer: Layer 3 covers dev; preview env gets a Clerk webhook pointed at its Vercel preview URL.

## Future work (out of scope, deferred to `docs/future-work/`)

- Bulk CMA-update propagation when `DEFAULT_*` constants change — requires firms-with-default-rows tracking and a migration pattern.
- Per-firm CMA versioning / history.
- UI for ordinary advisors (not admins) to view default CMAs as read-only reference while customizing client overrides.
