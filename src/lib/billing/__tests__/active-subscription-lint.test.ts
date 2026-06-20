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
  "src/app/api/portal/household/route.ts":
    "portal client mutation — firm/tenant-scoped via requireClientPortalAccess + requireEditEnabled (client bound to their own clientId); advisor-subscription gating deferred to the Phase 3.5 fleet sweep (parity with sibling family-members/entities/crm-contacts routes)",
  "src/app/api/portal/family/route.ts":
    "portal client mutation — firm/tenant-scoped via requireClientPortalAccess + requireEditEnabled; advisor-subscription gating deferred to Phase 3.5 (parity with sibling family-members route)",
  "src/app/api/portal/family/[id]/route.ts":
    "portal client mutation — firm/tenant-scoped via requireClientPortalAccess + requireEditEnabled; advisor-subscription gating deferred to Phase 3.5 (parity with sibling family-members/[memberId] route)",
  "src/app/api/portal/trusts/[id]/route.ts":
    "portal client mutation — firm/tenant-scoped via requireClientPortalAccess + requireEditEnabled; advisor-subscription gating deferred to Phase 3.5 (parity with sibling entities/[entityId] route)",
  "src/app/api/portal/plaid/link-token/route.ts":
    "portal client Plaid mutation — firm/tenant-scoped via requireClientPortalAccess + requireEditEnabled (client bound to own clientId); advisor-subscription gating deferred to Phase 3.5 (parity with sibling portal routes)",
  "src/app/api/portal/plaid/exchange/route.ts":
    "portal client Plaid mutation — firm/tenant-scoped via requireClientPortalAccess + requireEditEnabled (client bound to own clientId); advisor-subscription gating deferred to Phase 3.5 (parity with sibling portal routes)",
  "src/app/api/portal/plaid/exchange/commit/route.ts":
    "portal client Plaid mutation — firm/tenant-scoped via requireClientPortalAccess + requireEditEnabled (client bound to own clientId); advisor-subscription gating deferred to Phase 3.5 (parity with sibling portal routes)",
  "src/app/api/portal/plaid/items/[id]/refresh/route.ts":
    "portal client Plaid mutation — firm/tenant-scoped via requireClientPortalAccess + requireEditEnabled (client bound to own clientId); advisor-subscription gating deferred to Phase 3.5 (parity with sibling portal routes)",
  "src/app/api/portal/plaid/items/[id]/reauth-complete/route.ts":
    "portal client Plaid mutation — firm/tenant-scoped via requireClientPortalAccess + requireEditEnabled (client bound to own clientId); advisor-subscription gating deferred to Phase 3.5 (parity with sibling portal routes)",
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
