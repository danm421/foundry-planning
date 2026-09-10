/**
 * "Spouse" must not appear in anything an advisor or client can read.
 *
 * The second person in a household is a Co-client. The word survives only as a
 * tax or legal term of art (TERMS_OF_ART) or in a file that is factually about
 * the marital relationship (PERMANENT_ALLOWLIST).
 *
 * PENDING is a ratchet, not an allowlist: it lists files the sweep has not
 * reached yet, and it only ever shrinks. A file listed here that is already
 * clean also fails — that stops entries going stale and hiding a regression.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

/** Tax and legal language. Changing these makes the output wrong, not just differently worded. */
const TERMS_OF_ART =
  /(surviving\s+spouse|spousal|married\s+filing|qualifying\s+widow|marital\s+deduction|ex[-\s]spouse|former\s+spouse|deceased\s+spouse)/i;

/** Files that are legitimately about the marital relationship, forever. */
const PERMANENT_ALLOWLIST = new Set<string>([
  // The CRM records a real relationship (Spouse / Partner / Child), not a planning role.
  "src/lib/crm/relationship-labels.ts",
  "src/components/crm-contact-form.tsx",
  // Teaches the extractor to recognise OTHER software's wording in imported documents.
  "src/lib/extraction/prompts/savings.ts",
  // This test states the word in order to ban it.
  "src/__tests__/co-client-terminology.test.ts",
]);

/**
 * Files the sweep has not reached yet. DELETE YOUR TASK'S FILES AS YOU GO.
 * Replace this array with the 142 paths printed by the command in Step 2.
 */
const PENDING = new Set<string>([
  "src/__tests__/co-client-terminology.test.ts",
  "src/app/(app)/clients/[id]/assets/balance-sheet-report/balance-sheet-report-content.tsx",
  "src/app/(app)/clients/[id]/details/family/__tests__/family-scenario-rows.test.ts",
  "src/app/(app)/clients/[id]/details/plan-vs-return/suggestion-card.tsx",
  "src/app/(app)/clients/[id]/estate-planning/spine/lib/derive-beneficiary-detail.test.ts",
  "src/app/(app)/clients/[id]/estate-planning/spine/lib/derive-spine-data.ts",
  "src/app/(app)/clients/[id]/solver/__tests__/live-solver-workspace.test.tsx",
  "src/app/(app)/clients/[id]/solver/__tests__/min-savings-orchestration.test.tsx",
  "src/app/(app)/clients/[id]/solver/__tests__/solver-balance-sheet-panel.test.tsx",
  "src/app/(app)/clients/[id]/solver/__tests__/solver-chart-panel.test.tsx",
  "src/app/(app)/clients/[id]/solver/solver-content.tsx",
  "src/app/(app)/clients/[id]/solver/solver-row-incomes.tsx",
  "src/app/(app)/clients/[id]/solver/solver-row-life-expectancy.tsx",
  "src/app/(app)/clients/[id]/solver/solver-row-retirement-ages.tsx",
  "src/app/(app)/clients/[id]/solver/solver-row-savings-contributions.tsx",
  "src/app/(app)/clients/[id]/solver/solver-row-social-security.tsx",
  "src/app/(app)/clients/[id]/solver/solver-split-interest-form.tsx",
  "src/app/(app)/clients/[id]/solver/solver-ss-edit-dialog.tsx",
  "src/app/(app)/clients/[id]/solver/solver-tab-life-insurance.tsx",
  "src/app/(app)/clients/[id]/solver/solver-trust-form.tsx",
  "src/app/(app)/crm/households/[id]/tabs/contacts-tab.tsx",
  "src/app/(app)/risk/[clientId]/risk-detail-content.tsx",
  "src/app/api/clients/[id]/accounts/[accountId]/split/route.ts",
  "src/app/api/clients/[id]/accounts/__tests__/owners.test.ts",
  "src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts",
  "src/app/api/clients/[id]/entities/__tests__/route.test.ts",
  "src/app/api/clients/[id]/liabilities/__tests__/owners.test.ts",
  "src/app/api/clients/__tests__/post-spouse-defaults.test.ts",
  "src/components/__tests__/estate-flow-change-distribution-dialog.test.tsx",
  "src/components/balance-sheet-report/view-model.ts",
  "src/components/balance-sheet-report-pdf/__tests__/balance-sheet-pdf-document.test.tsx",
  "src/components/cashflow-report.tsx",
  "src/components/charts/__tests__/estate-comparison-chart.test.tsx",
  "src/components/charts/estate-comparison-chart.tsx",
  "src/components/crm-contact-form.tsx",
  "src/components/deductions-derived-summary.tsx",
  "src/components/deductions-itemized-list.tsx",
  "src/components/disability-panel.tsx",
  "src/components/disability-policy-dialog.tsx",
  "src/components/divorce/commit-preview-dialog.tsx",
  "src/components/divorce/divisible-card.tsx",
  "src/components/divorce/division-board.tsx",
  "src/components/divorce/settings-rail.tsx",
  "src/components/divorce/split-dialog.tsx",
  "src/components/estate-flow-change-distribution-dialog.tsx",
  "src/components/estate-flow-change-entity-owner-dialog.tsx",
  "src/components/estate-flow-change-owner-dialog.tsx",
  "src/components/estate-flow-remainder-dialog.tsx",
  "src/components/estate-flow-summary-detail-panel.tsx",
  "src/components/estate-tax-report-view.tsx",
  "src/components/family-view.tsx",
  "src/components/forms/__tests__/add-roth-conversion-form.test.tsx",
  "src/components/forms/__tests__/beneficiaries-tab.test.tsx",
  "src/components/forms/__tests__/ownership-editor.test.tsx",
  "src/components/forms/add-account-form.tsx",
  "src/components/forms/add-client-form.tsx",
  "src/components/forms/add-deduction-form.tsx",
  "src/components/forms/add-tax-adjustment-form.tsx",
  "src/components/forms/add-trust-form.tsx",
  "src/components/forms/beneficiaries-tab.tsx",
  "src/components/forms/bequest-recipient-list.tsx",
  "src/components/forms/ownership-editor.tsx",
  "src/components/forms/split-interest-funding-picker.tsx",
  "src/components/forms/tax-rates-form.tsx",
  "src/components/forms/transfers-tab.tsx",
  "src/components/gift-form.tsx",
  "src/components/household-map/__tests__/quick-edit-drawer.test.tsx",
  "src/components/household-map/net-worth-board.tsx",
  "src/components/import/plan-basics-step.tsx",
  "src/components/import/review-step-incomes.tsx",
  "src/components/import/review-step-insurance.tsx",
  "src/components/import/review-step-savings.tsx",
  "src/components/import/review-step-wills.tsx",
  "src/components/import/review-wizard.tsx",
  "src/components/income-expenses-view.tsx",
  "src/components/insurance-panel.tsx",
  "src/components/insurance-policy-details-tab.tsx",
  "src/components/insurance-policy-dialog.tsx",
  "src/components/intake/admin/diff-utils.ts",
  "src/components/intake/admin/review-detail.tsx",
  "src/components/intake/review-step.tsx",
  "src/components/intake/steps/__tests__/family-step.test.tsx",
  "src/components/intake/steps/accounts-step.tsx",
  "src/components/intake/steps/card-list.tsx",
  "src/components/intake/steps/goals-step.tsx",
  "src/components/intake/steps/income-step.tsx",
  "src/components/intake/steps/property-step.tsx",
  "src/components/medicare/__tests__/medicare-setup-dialog.test.tsx",
  "src/components/medicare/medicare-setup-dialog.tsx",
  "src/components/milestone-year-picker.tsx",
  "src/components/monte-carlo/report-view.tsx",
  "src/components/portal/household-contact-dialog.tsx",
  "src/components/presentations/pages/__tests__/estate-pages-render.test.tsx",
  "src/components/presentations/pages/life-insurance-summary/page-pdf.tsx",
  "src/components/quick-start/accounts-step.tsx",
  "src/components/quick-start/income-step.tsx",
  "src/components/quick-start/insurance-step.tsx",
  "src/components/report-controls/death-order-toggle.tsx",
  "src/components/risk/rtq-dialog.tsx",
  "src/components/risk/send-rtq-dialog.tsx",
  "src/components/risk-profile-pdf/__tests__/risk-profile-pdf-document.test.tsx",
  "src/components/social-security-card.tsx",
  "src/components/social-security-dialog.tsx",
  "src/components/solver/summaries/__tests__/life-insurance-summary-view.test.tsx",
  "src/components/solver/summaries/life-insurance-summary-view.tsx",
  "src/components/solver/summaries/medicare-summary-view.tsx",
  "src/components/state-death-tax-report-view.tsx",
  "src/components/stock-options/future-activity-ledger.tsx",
  "src/components/tax-adjustments-list.tsx",
  "src/components/tax-ledger/tax-ledger-year-picker.tsx",
  "src/components/unified-clients-table.tsx",
  "src/components/wills-panel.tsx",
  "src/components/yearly-estate-report-view.tsx",
  "src/components/yearly-estate-table.tsx",
  "src/domain/forge/__tests__/row-lines.test.ts",
  "src/domain/forge/preview.ts",
  "src/engine/__tests__/_fixtures/estate.ts",
  "src/engine/__tests__/capital-loss-carryforward.test.ts",
  "src/engine/__tests__/contribution-limits.test.ts",
  "src/engine/__tests__/death-event-locked-shares.integration.test.ts",
  "src/engine/__tests__/death-event.test.ts",
  "src/engine/__tests__/entity-cashflow.test.ts",
  "src/engine/__tests__/estate-tax-integration.test.ts",
  "src/engine/__tests__/fixtures/married-estate-fixture.ts",
  "src/engine/__tests__/projection-roth-fill-bracket-depleted.test.ts",
  "src/engine/__tests__/projection-roth-fill-bracket.test.ts",
  "src/engine/__tests__/projection-roth-joint-convergence.test.ts",
  "src/engine/__tests__/projection.test.ts",
  "src/engine/__tests__/run-projection-with-events.test.ts",
  "src/engine/death-event/__tests__/drain-attribution.test.ts",
  "src/engine/death-event/__tests__/estate-tax.test.ts",
  "src/engine/death-event/__tests__/final-death.test.ts",
  "src/engine/death-event/__tests__/first-death.test.ts",
  "src/engine/death-event/__tests__/inheritance-tax-md-dual.test.ts",
  "src/engine/death-event/__tests__/life-insurance-integration.test.ts",
  "src/engine/death-event/__tests__/partition-mixed-account-integration.test.ts",
  "src/engine/death-event/__tests__/section-2035-integration.test.ts",
  "src/engine/death-event/business-succession.ts",
  "src/engine/death-event/inheritance-tax.ts",
  "src/engine/death-event/shared.ts",
  "src/engine/what-if/__tests__/hypothetical-estate-tax.test.ts",
  "src/engine/what-if/__tests__/life-insurance-need.test.ts",
  "src/lib/__tests__/onboarding-step-status.test.ts",
  "src/lib/__tests__/owner-labels.test.ts",
  "src/lib/account-groups/__tests__/mutations.test.ts",
  "src/lib/audit/field-labels.ts",
  "src/lib/balance-sheet/__tests__/trust-details.test.ts",
  "src/lib/balance-sheet/trust-details.ts",
  "src/lib/clients/get-client-with-contacts.test.ts",
  "src/lib/crm/__tests__/import-e2e.test.ts",
  "src/lib/crm/import/columns.ts",
  "src/lib/crm/import/rows.ts",
  "src/lib/crm/relationship-labels.ts",
  "src/lib/divorce/__tests__/commit-divorce-plan.test.ts",
  "src/lib/divorce/__tests__/fixtures.ts",
  "src/lib/divorce/__tests__/side-totals.test.ts",
  "src/lib/divorce/commit-divorce-plan.ts",
  "src/lib/estate/__tests__/counterfactual.test.ts",
  "src/lib/estate/__tests__/derive-beneficiary-distribution-form.test.ts",
  "src/lib/estate/__tests__/estate-flow-diff.test.ts",
  "src/lib/estate/__tests__/estate-flow-ownership.test.ts",
  "src/lib/estate/__tests__/recipient-label.test.ts",
  "src/lib/estate/__tests__/transfer-report.test.ts",
  "src/lib/estate/estate-flow-diff.ts",
  "src/lib/estate/estate-flow-ownership.ts",
  "src/lib/estate/transfer-report.ts",
  "src/lib/estate/yearly-estate-report.ts",
  "src/lib/extraction/__tests__/classify.test.ts",
  "src/lib/extraction/prompts/savings.ts",
  "src/lib/household-map/approximate-milestones.ts",
  "src/lib/imports/__tests__/commit-modules.test.ts",
  "src/lib/imports/assemble/merge-across-files.ts",
  "src/lib/imports/commit/incomes.ts",
  "src/lib/imports/merge.ts",
  "src/lib/imports/planner/__tests__/golden-assertions.test.ts",
  "src/lib/insurance-policies/load-li-inventory.ts",
  "src/lib/intake/__tests__/estate.test.ts",
  "src/lib/intake/__tests__/note-body.test.ts",
  "src/lib/intake/estate.ts",
  "src/lib/intake/note-body.ts",
  "src/lib/life-event-markers.ts",
  "src/lib/life-insurance/__tests__/existing-coverage.test.ts",
  "src/lib/life-insurance/__tests__/test-helpers.ts",
  "src/lib/milestones.ts",
  "src/lib/observations/draft.ts",
  "src/lib/onboarding/step-status.ts",
  "src/lib/plan-text/observation-library.ts",
  "src/lib/plan-text/tokens.ts",
  "src/lib/presentations/pages/assumptions/view-model.ts",
  "src/lib/presentations/pages/cash-flow/view-model.ts",
  "src/lib/presentations/pages/client-profile/view-model.ts",
  "src/lib/presentations/pages/estate-gift-tax/view-model.ts",
  "src/lib/presentations/pages/estate-summary/__tests__/options.test.ts",
  "src/lib/presentations/pages/estate-summary/summarize-options.ts",
  "src/lib/presentations/pages/estate-transfer/view-model.ts",
  "src/lib/presentations/pages/household-map/view-model.ts",
  "src/lib/presentations/pages/life-insurance-summary/view-model.ts",
  "src/lib/presentations/pages/medicare-summary/view-model.ts",
  "src/lib/presentations/pages/retirement-comparison/view-model.test.ts",
  "src/lib/presentations/pages/retirement-summary/social-security.ts",
  "src/lib/presentations/pages/retirement-summary/view-model.ts",
  "src/lib/presentations/pages/scenario-changes/describe/kinds/plan.ts",
  "src/lib/presentations/pages/scenario-changes/describe/labels.ts",
  "src/lib/presentations/shared/markers.ts",
  "src/lib/projection-explain/__tests__/explain.test.ts",
  "src/lib/projection-explain/__tests__/tax-detectors.test.ts",
  "src/lib/projection-explain/__tests__/tax-diff.test.ts",
  "src/lib/quick-start/derive.ts",
  "src/lib/savings/__tests__/salary-options.test.ts",
  "src/lib/savings/salary-options.ts",
  "src/lib/scenario/describe-change-target.test.ts",
  "src/lib/scenario/describe-change-target.ts",
  "src/lib/solver/year-cell-drill.ts",
  "src/lib/tax/cell-drill/__tests__/_shared.test.ts",
  "src/lib/tax/cell-drill/__tests__/income-breakdown.test.ts",
  "src/lib/tax/state-inheritance/__tests__/golden/pa.test.ts",
  "src/lib/tax/state-inheritance/__tests__/special-rules.test.ts",
  "src/lib/tax/thresholds.ts",
  "src/lib/tax-reconciliation/__tests__/rules-social-security.test.ts",
  "src/lib/tax-reconciliation/rules/social-security.ts",
]);

/** A quoted string literal or a JSX text node — i.e. something a person reads. */
const DISPLAY = /("[^"\n]*\bSpouse\b[^"\n]*")|('[^'\n]*\bSpouse\b[^'\n]*')|(>[^<>{}\n]*\bSpouse\b[^<>{}\n]*<)|(`[^`\n]*\bSpouse\b[^`\n]*`)/g;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

function violations(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(DISPLAY)]
    .map((m) => m[0])
    .filter((hit) => !TERMS_OF_ART.test(hit));
}

describe("co-client terminology", () => {
  const files = walk(SRC)
    .map((f) => relative(process.cwd(), f))
    .filter((f) => !PERMANENT_ALLOWLIST.has(f));

  it("shows no file saying Spouse outside the pending ratchet", () => {
    const offenders = files.filter((f) => !PENDING.has(f) && violations(f).length > 0);
    expect(
      offenders.map((f) => `${f}: ${violations(f).join(" | ")}`),
      "New visible 'Spouse' copy. Use personLabel()/CO_CLIENT_LABEL from src/lib/owner-labels.ts.",
    ).toEqual([]);
  });

  it("holds no stale entry in the ratchet", () => {
    const stale = [...PENDING].filter((f) => violations(f).length === 0);
    expect(stale, "These files are clean — delete them from PENDING.").toEqual([]);
  });
});
