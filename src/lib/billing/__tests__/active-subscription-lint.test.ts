import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

function walkRoutes(dir: string, root: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      walkRoutes(full, root, out);
    } else if (entry === "route.ts") {
      out.push(path.relative(root, full).replace(/\\/g, "/"));
    }
  }
}

/**
 * Allowlist: routes that intentionally lack requireActiveSubscription.
 * Each entry MUST have a one-line justification — keep it explicit so
 * future devs can reason about why a route is exempt.
 *
 * Anything tagged "pre-Phase-3 — wire in Phase 3.5" is a mutation route
 * that existed before billing gating shipped; the helper will be added
 * in a follow-up sweep once the founder-org bypass has been validated
 * against the two pilot routes (POST /api/clients, POST /api/clients/
 * [id]/imports/[importId]/extract).
 */
const ALLOWLIST: Record<string, string> = {
  "src/app/api/webhooks/stripe/route.ts":
    "Stripe webhook — not a user mutation",
  "src/app/api/webhooks/clerk/route.ts": "Clerk webhook — not a user mutation",
  "src/app/api/webhooks/plaid/route.ts":
    "Plaid webhook — JWT-verified, system-driven; no session firm context and must process regardless of firm billing state",
  "src/app/api/cron/reconcile-billing/route.ts":
    "system cron — not a user mutation",
  "src/app/api/csp-report/route.ts": "CSP telemetry — public, pre-auth",
  "src/app/api/billing/portal/route.ts":
    "Stripe Customer Portal session — must stay reachable for past-due/unpaid/canceled owners to fix payment; gated by requireBillingContact",
  "src/app/api/clients/[id]/accounts/[accountId]/allocations/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/accounts/[accountId]/beneficiaries/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/accounts/[accountId]/flow-overrides/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/accounts/[accountId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/accounts/[accountId]/split/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/accounts/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/asset-transactions/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/liquidity-report/export-pdf/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/deductions/[deductionId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/deductions/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/entities/[entityId]/assets/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/entities/[entityId]/beneficiaries/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/entities/[entityId]/ensure-cash/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/entities/[entityId]/flow-overrides/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/entities/[entityId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/entities/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/expenses/[expenseId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/expenses/[expenseId]/schedule/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/expenses/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/external-beneficiaries/[beneficiaryId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/external-beneficiaries/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/family-members/[memberId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/family-members/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/gifts/[giftId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/gifts/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/gifts/series/[seriesId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/gifts/series/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/incomes/[incomeId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/incomes/[incomeId]/schedule/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/incomes/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/imports/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/imports/[importId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/imports/[importId]/commit/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/imports/[importId]/discard/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/imports/[importId]/match/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/imports/[importId]/files/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/imports/[importId]/files/[fileId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/imports/[importId]/files/[fileId]/extract/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/insurance-policies/[policyId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/insurance-policies/[policyId]/schedule/upload-csv/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/insurance-policies/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/liabilities/[liabilityId]/extra-payments/[extraPaymentId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/liabilities/[liabilityId]/extra-payments/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/liabilities/[liabilityId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/liabilities/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/monte-carlo-data/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/open-items/[itemId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/open-items/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/plan-settings/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/presentation-templates/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/presentation-templates/[id]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/report-comments/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/comparison-layout/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/comparison-plans/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/comparison/describe-changes/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/reset-account-growth/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/route.ts": "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/savings-rules/[ruleId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/savings-rules/[ruleId]/schedule/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/savings-rules/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/scenarios/[sid]/changes/[cid]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/scenarios/[sid]/changes/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/scenarios/[sid]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/scenarios/[sid]/sale-to-trust/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/scenarios/[sid]/toggle-groups/[gid]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/scenarios/[sid]/toggle-groups/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/scenarios/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/solver/solve/route.ts":
    "SSE goal-seek — read-only on DB, no mutation; allowlisted for parity with other solver routes",
  "src/app/api/clients/[id]/life-insurance/solve/route.ts":
    "life-insurance solver — read-only on DB, no mutation; parity with solver/solve",
  "src/app/api/clients/[id]/life-insurance/solve-mc/route.ts":
    "life-insurance MC solver (SSE) — read-only on DB, no mutation; parity with solver/solve",
  "src/app/api/clients/[id]/life-insurance/over-time/route.ts":
    "life-insurance need-over-time compute (SSE) — read-only on DB, no mutation; parity with solver/solve",
  "src/app/api/clients/[id]/solver/life-insurance-summary/route.ts":
    "live LI-summary solve (working tree → LiSolved) — read-only on DB, no mutation; parity with solver/solve",
  "src/app/api/clients/[id]/life-insurance/settings/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/snapshots/[snapId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/snapshots/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/transfers/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/reinvestments/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/roth-conversions/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/wills/[willId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/wills/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/withdrawal-strategy/[strategyId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/withdrawal-strategy/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/asset-classes/[id]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/asset-classes/route.ts": "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/migrate-to-standard/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/model-portfolios/[id]/allocations/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/model-portfolios/[id]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/model-portfolios/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/seed/route.ts": "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/refresh-standard-values/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/refresh-projected-values/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/sets/[key]/values/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/cma/sets/active/route.ts": "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/route.ts": "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/restore/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/permanent/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/open/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/accounts/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/accounts/[accountId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/activity/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/contacts/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/contacts/[contactId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/documents/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/documents/[docId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/folders/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/households/[id]/folders/[folderId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/import/preview/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/import/commit/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/tags/route.ts": "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/tasks/route.ts": "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/tasks/[taskId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/tasks/[taskId]/status/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/tasks/[taskId]/comments/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/tasks/[taskId]/files/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/tasks/[taskId]/files/[fileId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/tasks/[taskId]/tags/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/crm/tasks/[taskId]/tags/[tagId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/firms/comparison-templates/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/firms/comparison-templates/[tid]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/account-groups/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/account-groups/[groupId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/accounts/[accountId]/holdings/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/accounts/[accountId]/holdings/[holdingId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/accounts/[accountId]/holdings/[holdingId]/override/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/accounts/[accountId]/holdings/classify/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/analysis/retirement/options/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/analysis/retirement/pos/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/analysis/retirement/project/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/analysis/retirement/save-to-base/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/comparison/ai-analysis/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/comparisons/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/comparisons/[cid]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/comparisons/[cid]/save-as-template/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/medicare-coverage/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/notes-receivable/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/notes-receivable/[noteId]/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/notes-receivable/[noteId]/extra-payments/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/solver/monte-carlo/route.ts":
    "MC probability-of-success compute — read-only on DB, no mutation; parity with other solver routes",
  "src/app/api/clients/[id]/solver/project/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/solver/save-scenario/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  "src/app/api/clients/[id]/solver/save-to-base/route.ts":
    "pre-Phase-3 — wire in Phase 3.5",
  // Portal mutation routes were here ("deferred to Phase 3.5"); Phase 3.5 (portal
  // slice) now gates them via requirePortalActiveSubscription — see the matcher
  // below. No portal allowlist entries should exist.

  // Client intake / data-collection. The routes that write live planning data
  // gate natively: POST /api/data-collection (send) and apply/route.ts both call
  // requireActiveSubscriptionForFirm; /api/intake/[token]/submit + /api/portal/intake
  // gate via their own sub helpers. The three below are deliberately exempt:
  "src/app/api/intake/[token]/route.ts":
    "public token-scoped autosave — staging-only (writes only intake_forms.payload, never live data); firm-active is gated at submit",
  "src/app/api/intake/[token]/documents/route.ts":
    "public token-scoped document upload — same shape as the autosave above: no Clerk org session exists to check, authorization IS the intake identity gate, and it writes only the client's own staged attachments; firm-active is gated at submit",
  "src/app/api/intake/[token]/documents/[docId]/route.ts":
    "public token-scoped delete of a document the same client just uploaded, draft-only — no live planning data, and refusing it on a lapsed subscription would strand a client with a mis-uploaded file they cannot remove",
  "src/app/api/data-collection/[id]/discard/route.ts":
    "advisor lifecycle — flips a form to discarded; writes no live planning data",
  "src/app/api/data-collection/[id]/revoke/route.ts":
    "advisor lifecycle — flips a draft form to expired; writes no live planning data",
  "src/app/api/data-collection/email-settings/route.ts":
    "advisor email-template config — writes only intake_email_settings (the advisor's own invitation copy), no live planning data; the send path POST /api/data-collection is itself sub-gated",

  // ── 2026-09-03 sweep. Every remaining ungated mutation route was read and
  // split gate-vs-exempt on Dan's line: "writes live client planning data"
  // gates, "firm/advisor config, a lifecycle flip, or no DB write at all"
  // is exempt. 24 routes took the helper; these 14 are the exemptions, each
  // with the reason it is not just another "wire in Phase 3.5" deferral.

  // (a) POSTs that compute and return — they mutate NOTHING, so there is no
  //     write for a subscription gate to protect. Same ruling as solver/solve.
  "src/app/api/clients/[id]/rebalance/compute/route.ts":
    "rebalance trade-list compute — read-only on DB, no mutation; parity with solver/solve",
  "src/app/api/clients/[id]/solver/education-solve/route.ts":
    "education dedicated-savings solve — read-only on DB, no mutation; parity with solver/solve",
  "src/app/api/clients/[id]/solver/retirement-comparison/route.ts":
    "retirement-comparison solve — read-only on DB (compute cache only, same as the already-exempt solver/monte-carlo); no mutation",
  "src/app/api/crm/import/remap/route.ts":
    "rebuilds an import PREVIEW in memory from rows the caller posted — writes nothing; crm/import/commit is the write and is separately listed",
  "src/app/api/integrations/[provider]/test/route.ts":
    "credential pre-flight probe — calls the provider and returns ok/failure, stores nothing; the connect POST it precedes IS gated",

  // (b) A viewer preference on the client row, not planning data.
  "src/app/api/clients/[id]/view-mode/route.ts":
    "which Details tab a household opens on (clients.details_view_mode) — a UI preference, deliberately narrower than the client PUT; no planning data",
  "src/app/api/presentation-templates/builtins/[slug]/dismiss/route.ts":
    "per-user hide/restore of a built-in template in the picker — a UI preference keyed to the advisor, no client data",
  "src/app/api/onboarding/first-run/route.ts":
    "advisor onboarding checklist start/dismiss — a lifecycle flip on the advisor's own row, no client data",

  // (c) Must stay reachable precisely BECAUSE the firm has lapsed. Blocking
  //     these would strand a departing customer with our product holding their
  //     credentials, their records, or an access grant they cannot revoke.
  "src/app/api/integrations/[provider]/disconnect/route.ts":
    "revokes the firm's OWN stored provider credentials — a lapsed or departing firm must always be able to pull its API keys back out of us",
  "src/app/api/integrations/[provider]/recheck/route.ts":
    "re-verifies stored credentials and writes only that connection's own status row — the one button whose job is explaining why a feed is broken",
  "src/app/api/shares/[shareId]/route.ts":
    "revokes a client/household share — removing someone else's access must never be the thing billing blocks",
  "src/app/api/feedback/route.ts":
    "support contact form (rate-limited, emails us; no DB write) — a firm that cannot reach support cannot tell us its billing is broken; same reasoning as billing/portal",
  "src/app/api/firm/compliance-exports/route.ts":
    "enqueues the firm's own regulatory export of its own records — a cancelling firm needs its compliance archive on the way out, and admin + one-batch-at-a-time already bound it",

  // (d) Public intake family — joins the three token-scoped exemptions above.
  "src/app/api/intake/[token]/verify/route.ts":
    "public token-scoped identity gate: writes only intake_forms.opened_at (first-access stamp) plus audit, and there is no Clerk session to read a firm from; firm-active is gated at submit",

  // Per-advisor branding (Task 14). Same shape as the email-settings exemption
  // above: firm/advisor config, not live planning data, so a lapsed
  // subscription shouldn't block fixing a broken brand field (e.g. a
  // malformed emailReplyTo silently breaking intake-invite delivery).
  "src/app/api/advisor-branding/route.ts":
    "per-advisor branding config (logo/color/contact/email-from-reply-to) — writes only advisor_profiles, no live planning data",
  "src/app/api/advisor-branding/[advisorUserId]/enabled/route.ts":
    "admin-only branding grant toggle — writes only advisor_profiles.branding_enabled, no live planning data",
};

const MUTATION_VERBS = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/;

const repoRoot = resolve(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "..",
  "..",
);

describe("active-subscription lint", () => {
  it("every mutation route either calls requireActiveSubscription or is allowlisted", () => {
    const files: string[] = [];
    walkRoutes(path.join(repoRoot, "src/app/api"), repoRoot, files);
    const violations: string[] = [];

    for (const rel of files) {
      const body = readFileSync(path.join(repoRoot, rel), "utf8");
      if (!MUTATION_VERBS.test(body)) continue;
      if (ALLOWLIST[rel]) continue;
      if (body.includes("requireActiveSubscription")) continue;
      // Portal routes gate via the firm-keyed wrapper (portal users have no
      // orgId). NB: "requirePortalActiveSubscription" does NOT contain the
      // substring "requireActiveSubscription", so this needs its own check.
      if (body.includes("requirePortalActiveSubscription")) continue;
      // `resolvePortalWriteContext` is the portal mutation entry point and
      // calls requirePortalActiveSubscription unconditionally before it
      // returns, so a route using it is gated without naming the helper.
      if (body.includes("resolvePortalWriteContext")) continue;
      violations.push(rel);
    }

    expect(
      violations,
      `Mutation routes missing requireActiveSubscription:\n  ${violations.join(
        "\n  ",
      )}\n\nAdd the helper to the route, OR add an explicit allowlist entry in active-subscription-lint.test.ts with a one-line justification.`,
    ).toEqual([]);
  });
});
