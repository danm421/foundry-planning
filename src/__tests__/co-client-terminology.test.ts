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

/** Tax and legal language. Changing these makes the output wrong, not just differently worded.
 *  `non[-\s]spouse,?\s*non[-\s]charity` protects the exact IRS-defined inherited-IRA beneficiary
 *  phrase in tax-rates-form.tsx's IRD tax rate help text (a surviving-spouse beneficiary may roll
 *  over into their own IRA and use the Uniform Lifetime Table; a non-spouse beneficiary may not —
 *  the same doctrinal boundary "Spousal rollover" protects, on the other side of it). Scoped to
 *  the compound "non-spouse, non-charity" phrase, not bare "non-spouse", so it doesn't swallow
 *  unrelated "non-spouse recipients"-style copy elsewhere that isn't this IRS term. */
const TERMS_OF_ART =
  /(surviving\s+spouse|spousal|married\s+filing|qualifying\s+widow|marital\s+deduction|ex[-\s]spouse|former\s+spouse|deceased\s+spouse|non[-\s]spouse,?\s*non[-\s]charity)/i;

/** Files that are legitimately about the marital relationship, forever. */
const PERMANENT_ALLOWLIST = new Set<string>([
  // The CRM records a real relationship (Spouse / Partner / Child), not a planning role.
  "src/lib/crm/relationship-labels.ts",
  "src/components/crm-contact-form.tsx",
  // Teaches the extractor to recognise OTHER software's wording in imported documents.
  "src/lib/extraction/prompts/savings.ts",
  // This test states the word in order to ban it.
  "src/__tests__/co-client-terminology.test.ts",
  // Same crm_household_contacts `role` field (primary/spouse/dependent/other) that
  // crm-contact-form.tsx already treats as a real CRM relationship label, not a
  // planning role (see that file's entry above) — this is its read-only badge.
  "src/app/(app)/crm/households/[id]/tabs/contacts-tab.tsx",
  "src/app/(app)/crm/households/[id]/tabs/__tests__/contacts-tab.test.tsx",
  // Only hit is `currentSalaryByPerson={{ client: salaryFor("client"), spouse: salaryFor("spouse") }}` —
  // an object key / engine person-id argument (Bucket C), not display copy. The
  // naive quote-pairing scanner matches text spanning the two separate string
  // literals on that line, not a real "Spouse" string.
  "src/app/(app)/clients/[id]/details/insurance/insurance-content.tsx",
  // Only hit is the template literal `${spouse.firstName} ${spouse.lastName}` —
  // `spouse` there is a local variable holding a CRM contact record; the scanner
  // matches the variable name inside the backticks, not literal display text.
  "src/app/(app)/clients/[id]/portal/page.tsx",

  // ── Task 6: estate spine cards use a `--color-spouse` Tailwind design token
  // (src/app/globals.css) for the household's second-person color swatch —
  // `border-spouse/30`, `bg-spouse/15`, etc. The token name is a Bucket C
  // design-system identifier, never rendered as text a person reads.
  "src/app/(app)/clients/[id]/estate-planning/spine/combined-block.tsx",
  "src/app/(app)/clients/[id]/estate-planning/spine/pair-row.tsx",

  // ── Task 6 fix round 2 (2026-09-10): round 1's F3(a) named 5 specific
  // fallback-label sites but missed 4 more in the identical class (same
  // `people.spouseName || <literal>` pattern, same files). Fixed here, and
  // `commit-preview-dialog.tsx`, `divorce-workbench.tsx`, and
  // `divisible-card.tsx` all dropped to zero remaining "Spouse" hits as a
  // result — all three REMOVED from this list entirely.
  //
  // Five files that were here for `it()`-title prose alone were MOVED to
  // PENDING (see below) instead of staying permanently allowlisted: a test
  // title is developer-facing and arguably exempt on its own, but
  // PERMANENT_ALLOWLIST retires an entire file forever — a genuinely
  // user-visible "Spouse" added later to one of those files would never be
  // caught. Task 11 inherits ~150 other unowned test-file entries already in
  // PENDING; these 5 need the same one consistent policy, decided in the
  // open, not a one-off exemption made inside a fix round.
  //
  // What's left here is only what's actually settled:
  "src/lib/divorce/__tests__/commit-divorce-plan.test.ts", // genuine ex-spouse/former-spouse hits (4), plus it() titles
  "src/lib/divorce/commit-divorce-plan.ts", // genuine ex-spouse/former-spouse hits (12), plus an unreachable "Spouse contact is incomplete" error (F3(b): never sent to the client — see task-6-report.md)
  // Product decision 2: both files below describe the CRM household contact
  // whose `role` column is literally "spouse" (crmHouseholdContacts.role —
  // commit-preview.ts:236, divorce-plans.ts:89) — a factual CRM relationship
  // field, not a planning-role label. Renaming the message text would make it
  // describe a role the contact record doesn't actually have.
  "src/lib/divorce/commit-preview.ts", // label: "The spouse contact is missing a name or date of birth" (:416)
  "src/lib/divorce/divorce-plans.ts", // error message: "Household has no spouse contact" (:110)
  // Product decision 3: the legal, in-divorce usage — "the departing spouse"
  // describes the real person going through this divorce, not the ordinary
  // co-client sense the rest of the app uses "spouse" for.
  "src/components/divorce/settings-rail.tsx", // FieldTooltip help text: "Where the departing spouse's new household files..." (:171)

  // ── Task 8 (2026-09-10): scanner artifacts and machine-facing diagnostics.
  // None of these files has a person-visible "Spouse" — the scanner's naive
  // quote-pairing and its blindness to `${}` interpolation both produce hits
  // that are not real display copy. Each reason below names the file's only
  // actual hit(s), same standard as the entries above.
  "src/lib/tax-reconciliation/rules/wages.ts", // No display copy anywhere in the file says "Spouse" — grepped case-insensitively and confirmed. Both ratchet hits are scanner artifacts: `${spouse ? "..." : ""}` (:90) matches the bare `spouse` BOOLEAN variable name inside the interpolation, and the `ownerChoices: spouse ? ["client", "spouse"]` line (:138) is a mismatched quote-pairing span (the naive scanner pairs the closing quote of an unrelated backtick-embedded string with the opening quote of `"client"`, spanning across the bare `spouse` identifier in between) — the same class already documented above for insurance-content.tsx and portal/page.tsx.
  "src/components/cashflow/medicare/medicare-year-table.tsx", // Only hit is `` ` / ${y.ages.spouse}` `` (:89) — `y.ages.spouse` is a property access on a numeric ages object (an age, e.g. 63), never the word "Spouse"; the scanner matches the bare property name inside the template literal, not display text. Same class as `insurance-content.tsx`'s already-documented `spouse: salaryFor("spouse")` entry above.
  "src/engine/life-insurance-expiry.ts", // Only hit is a thrown Error's message, `computeTermEndYear: missing spouse dob/retirementAge for ${insured}-insured policy` (:23) — a developer-facing exception, never rendered to an advisor or client.
  "src/engine/what-if/life-insurance-need.ts", // Two hits, both machine-facing: a JSDoc code span documenting the `deceased === "spouse"` comparison (:79), and a thrown Error's message, `buildLifeInsuranceWhatIfData: deceased='spouse' requires spouseDob` (:333) — a developer diagnostic, not display copy.
  "src/lib/life-insurance/need-over-time.ts", // Only hit is a JSDoc code span documenting the same `deceased === "spouse"` comparison the engine throws on (:42) — internal type documentation, not display copy.
  "src/lib/medicare/dbMapper.ts", // Only hit is a thrown Error validating an unexpected DB row value, `medicare_coverage row has unexpected owner "${row.owner}" — expected "client" or "spouse"` (:13) — a developer diagnostic on a malformed row, never shown to a user.
  "src/lib/risk/existing-scores.ts", // Only hit is a JSDoc "KNOWN LIMITATION" comment naming the `subject === "spouse"` branch (:26) — internal documentation of a scoring edge case, not display copy.
  "src/lib/household-map/social-security.ts", // Only hit is a JSDoc comment, "The owner's DOB for an SS row — the SPOUSE's for a spouse-owned benefit" (:20), documenting `ownerDob`'s internal side-selection logic. The file's actual user-facing labels ("no benefit", "at 67", etc.) never mention spouse.

  // ── Task 9 (2026-09-10): scanner artifacts (numeric-age/property-name false
  // positives) and machine-facing JSDoc enum documentation. Each reason names
  // the file's only actual hit(s), same standard as the Task 8 block above.
  "src/components/balance-sheet-report/year-picker.tsx", // Only hit is `` `${a.client} & ${a.spouse}` `` (:26) — `a.spouse` is a numeric age property access (e.g. 65), never the word "Spouse" rendered; same class as `medicare-year-table.tsx` above.
  "src/components/cashflow/projection-ages.ts", // Only hit is `` `${client} / ${spouse}` `` (:24) — `spouse` is a local const already resolved to a dash or a numeric-age string (:23), never the literal word "Spouse".
  "src/components/client-identity-menu.tsx", // Only hits are `spouse.firstName`/`spouseLast` (:57-60) — `spouse` is a local variable holding a real PersonInfo record; the interpolation renders the person's actual name, never the word "Spouse". The component has no other display copy naming the role at all — the household title and age line always use real names.
  "src/components/monte-carlo/yearly-breakdown.tsx", // Only hit is `` `${y.age.client} / ${y.age.spouse}` `` (:38) — `y.age.spouse` is a numeric age property access, same class as year-picker.tsx above.
  "src/components/income-expenses/__tests__/row.test.tsx", // Only hit is a comment documenting the `InlineOwnerCell` owner enum, `` `"client" | "spouse" | "joint"` `` (:8) — machine-facing type documentation, not display copy.
  "src/components/income-expenses-view.tsx", // The one real display hit — the Medicare-eligibility owner `<option value="spouse">Spouse</option>` (:1666, pre-edit) — was renamed to `{CO_CLIENT_LABEL}` in this task. The only hit left is a JSDoc comment documenting the income `owner` enum, `` `client | spouse | joint` `` (:1835) — machine-facing type documentation. This file is large and actively edited; a future user-visible "Spouse" string elsewhere in it would not be caught by the ratchet, but the residual hit is genuinely enum documentation, not a scanner artifact worth leaving in PENDING forever.
  "src/components/tax-ledger/tax-ledger-year-picker.tsx", // The real display hit — the age-label fallback `spouseName?.trim() || "Spouse"` (:53, pre-edit) — was renamed to `CO_CLIENT_LABEL` in this task. The residual hit is a scanner artifact: the same backtick template literal also references the `spouseName` parameter and `ages.spouse` property by name, so the naive scanner still matches the line even though it no longer renders the word "Spouse".
  "src/lib/solver/cashflow-year-detail.ts", // Only hit is `` `Age ${year.ages.client} / ${year.ages.spouse}` `` (:114) — `year.ages.spouse` is a numeric age property access, same class as the two age-label files above.
  "src/lib/tax/state-inheritance/types.ts", // Only hit is a JSDoc comment describing PA's actual statutory Class A definition, `"PA Class A is \"spouse + minor child only\""` (:24) — a real, accurate tax-law description (analogous to "Married filing jointly"), not app terminology, and not display copy (this file has no runtime logic, only type declarations). The `"spouse-role"` classSource literal (:53) and the `"spouse"` union member (:93) are single-word Bucket C enum references the scanner already excludes.
]);

/** Directory prefixes that are also allowlisted (Bucket C: machine-facing enum documentation). */
const ALLOWLIST_PREFIXES = [
  "src/lib/extraction/prompts/",
  "src/domain/forge/tools/",
];

/**
 * Files the sweep has not reached yet. DELETE YOUR TASK'S FILES AS YOU GO.
 * Replace this array with the paths printed by the command in Step 2.
 */
const PENDING = new Set<string>([

  // ── Task 7 review fix (2026-09-10): returned to PENDING deliberately.
  // Its only hit is an `it()` title naming the DB `role` column's literal enum
  // values, `client` and `spouse`. Those are Bucket C — never renamed — and the
  // fixture two lines below still writes `role: "spouse"`, so a title saying
  // "Co-client" misdescribed the data under test. Reverted to the real enum,
  // which the scanner cannot tell from display copy. Same policy question as
  // the block below; Task 11 decides it for all of them at once.
  "src/lib/presentations/pages/client-profile/__tests__/view-model.test.ts",

  // ── Task 6 fix round 2 (2026-09-10): relocated from PERMANENT_ALLOWLIST.
  // Each of these 5 files' only hit is `it()`-title prose describing
  // spouse-side divorce mechanics (e.g. "moves the spouse 401(k) to S") — not
  // display copy a person reads. That's arguably exempt on its own, but
  // PERMANENT_ALLOWLIST retires the whole file forever, so a real
  // user-visible "Spouse" string added to one of these later would never be
  // caught. PENDING is the honest, reversible home until Task 11 decides one
  // policy for this file and its ~150 unowned siblings already below. Do NOT
  // rename these titles as part of that move — only the entry moved.
  "src/components/divorce/__tests__/division-board.test.tsx",
  "src/lib/divorce/__tests__/allocation-rules.test.ts",
  "src/lib/divorce/__tests__/commit-preview.test.ts",
  "src/lib/divorce/__tests__/divisible-objects.test.ts",
  "src/lib/divorce/__tests__/side-totals.test.ts",

  "src/components/__tests__/beneficiary-summary.test.tsx",
  "src/components/__tests__/client-identity-menu.test.tsx",
  "src/components/__tests__/gift-cumulative-table.test.tsx",
  "src/components/__tests__/gift-dialog.test.tsx",
  "src/components/__tests__/income-expenses-view-owner-years.test.tsx",
  "src/components/__tests__/insurance-panel.test.tsx",
  "src/components/balance-sheet-report/__tests__/balance-sheet-report.test.tsx",
  "src/components/balance-sheet-report/__tests__/household-columns.test.ts",
  "src/components/balance-sheet-report/__tests__/view-model.test.ts",
  "src/components/crm-household-form.tsx",
  "src/components/crm-import-preview.tsx",
  "src/components/forge/forge-panel.tsx",
  "src/components/household-map/__tests__/goals-board.test.tsx",
  "src/components/household-map/__tests__/household-map-view.test.tsx",
  "src/components/household-map/__tests__/quick-edit-drawer.test.tsx",
  "src/components/import/__tests__/assumed-chip.test.tsx",
  "src/components/import/__tests__/plan-basics-step.test.tsx",
  "src/components/import/__tests__/review-step-accounts.test.tsx",
  "src/components/import/plan-basics-step.tsx",
  "src/components/import/review-step-family.tsx",
  "src/components/import/review-step-incomes.tsx",
  "src/components/import/review-step-insurance.tsx",
  "src/components/import/review-step-savings.tsx",
  "src/components/import/review-wizard.tsx",
  "src/components/portal/household-contact-dialog.tsx",
  "src/components/risk-profile-pdf/__tests__/risk-profile-pdf-document.test.tsx",
  "src/db/schema.ts",
  "src/domain/forge/__tests__/preview.test.ts",
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
  "src/engine/__tests__/gift-exemption-warning.test.ts",
  "src/engine/__tests__/gift-ledger.test.ts",
  "src/engine/__tests__/income.test.ts",
  "src/engine/__tests__/ira-basis.test.ts",
  "src/engine/__tests__/ira-post-tax-basis-distribution.test.ts",
  "src/engine/__tests__/life-insurance-expiry.test.ts",
  "src/engine/__tests__/life-insurance-payout-visibility.test.ts",
  "src/engine/__tests__/planSupplementalWithdrawal.test.ts",
  "src/engine/__tests__/projection-roth-fill-bracket-depleted.test.ts",
  "src/engine/__tests__/projection-roth-fill-bracket.test.ts",
  "src/engine/__tests__/projection-roth-joint-convergence.test.ts",
  "src/engine/__tests__/projection.entity-distribution.test.ts",
  "src/engine/__tests__/projection.test.ts",
  "src/engine/__tests__/retirement-proration.test.ts",
  "src/engine/__tests__/roth-irmaa-cap-regression.test.ts",
  "src/engine/__tests__/run-projection-with-events.test.ts",
  "src/engine/__tests__/slat-40-year.integration.test.ts",
  "src/engine/__tests__/step-up-cap-gains.test.ts",
  "src/engine/__tests__/stress-disability.test.ts",
  "src/engine/__tests__/surplus-spend.test.ts",
  "src/engine/__tests__/threshold-golden-projection.test.ts",
  "src/engine/__tests__/threshold-household.test.ts",
  "src/engine/contribution-limits.ts",
  "src/engine/death-event/__tests__/business-succession.test.ts",
  "src/engine/death-event/__tests__/drain-attribution.test.ts",
  "src/engine/death-event/__tests__/estate-tax.test.ts",
  "src/engine/death-event/__tests__/final-death.test.ts",
  "src/engine/death-event/__tests__/first-death.test.ts",
  "src/engine/death-event/__tests__/grantor-succession.test.ts",
  "src/engine/death-event/__tests__/inheritance-tax-md-dual.test.ts",
  "src/engine/death-event/__tests__/ird-surviving-spouse.test.ts",
  "src/engine/death-event/__tests__/ird-tax.test.ts",
  "src/engine/death-event/__tests__/life-insurance-integration.test.ts",
  "src/engine/death-event/__tests__/partition-mixed-account-integration.test.ts",
  "src/engine/death-event/__tests__/section-2035-integration.test.ts",
  "src/engine/death-event/__tests__/shared.test.ts",
  "src/engine/death-event/__tests__/survivor-recipient-id.test.ts",
  "src/engine/death-event/__tests__/will-residuary.test.ts",
  "src/engine/death-event/business-succession.ts",
  "src/engine/death-event/first-death.ts",
  "src/engine/death-event/inheritance-tax.ts",
  "src/engine/death-event/section-2035-lookback.ts",
  "src/engine/death-event/shared.ts",
  "src/engine/family-cashflow.ts",
  "src/engine/monteCarlo/__tests__/summarize.test.ts",
  "src/engine/projection.ts",
  "src/engine/scenario/__tests__/applyChanges.test.ts",
  "src/engine/socialSecurity/__tests__/claimAge.test.ts",
  "src/engine/socialSecurity/__tests__/orchestrator.test.ts",
  "src/engine/socialSecurity/__tests__/spousal.test.ts",
  "src/engine/trust-tax/__tests__/apply-trust-annual-pass.test.ts",
  "src/engine/trust-tax/route-dni.ts",
  "src/engine/what-if/__tests__/hypothetical-estate-tax.test.ts",
  "src/lib/__tests__/client-search.test.ts",
  "src/lib/__tests__/entity-owners-ops.test.ts",
  "src/lib/__tests__/milestones.test.ts",
  "src/lib/__tests__/onboarding-step-status.test.ts",
  "src/lib/__tests__/owner-labels.test.ts",
  "src/lib/__tests__/plan-horizon.test.ts",
  "src/lib/account-groups/__tests__/mutations.test.ts",
  "src/lib/balance-sheet/__tests__/attribute.test.ts",
  "src/lib/clients/__tests__/mirror-contact-to-crm.test.ts",
  "src/lib/clients/get-client-with-contacts.test.ts",
  "src/lib/compute-cache/assemble-monte-carlo-result.test.ts",
  "src/lib/crm/__tests__/contact-sections.test.ts",
  "src/lib/crm/__tests__/contacts.test.ts",
  "src/lib/crm/__tests__/household-name.test.ts",
  "src/lib/crm/__tests__/households-create.test.ts",
  "src/lib/crm/__tests__/households-family.test.ts",
  "src/lib/crm/__tests__/import-e2e.test.ts",
  "src/lib/crm/__tests__/selectors.test.ts",
  "src/lib/crm/__tests__/sort.test.ts",
  "src/lib/crm/__tests__/sync-household-name.test.ts",
  "src/lib/crm/import/__tests__/rows.test.ts",
  "src/lib/crm/import/columns.ts",
  "src/lib/crm/import/rows.ts",
  "src/lib/extraction/__tests__/classify.test.ts",
  "src/lib/extraction/__tests__/will-prompt.test.ts",
  "src/lib/extraction/identify-household.ts",
  "src/lib/household-map/__tests__/build-boards.test.ts",
  "src/lib/household-map/__tests__/columns.test.ts",
  "src/lib/household-map/__tests__/goals.test.ts",
  "src/lib/household-map/__tests__/life-expectancy-write.test.ts",
  "src/lib/household-map/__tests__/social-security.test.ts",
  "src/lib/imports/__tests__/commit-modules.test.ts",
  "src/lib/imports/__tests__/import-milestones.test.ts",
  "src/lib/imports/__tests__/living-slot.test.ts",
  "src/lib/imports/__tests__/match.test.ts",
  "src/lib/imports/__tests__/merge.test.ts",
  "src/lib/imports/__tests__/owner-match.test.ts",
  "src/lib/imports/__tests__/plan-builder-core.test.ts",
  "src/lib/imports/__tests__/reconcile-compensation.test.ts",
  "src/lib/imports/assemble/__tests__/gap-fill.test.ts",
  "src/lib/imports/assemble/__tests__/income-timing.test.ts",
  "src/lib/imports/assemble/__tests__/merge-across-files.test.ts",
  "src/lib/imports/assemble/__tests__/plan-basics.test.ts",
  "src/lib/imports/assemble/gap-fill.ts",
  "src/lib/imports/assemble/income-timing.ts",
  "src/lib/imports/assemble/merge-across-files.ts",
  "src/lib/imports/commit/__tests__/clients-identity.test.ts",
  "src/lib/imports/commit/__tests__/plan-basics.test.ts",
  "src/lib/imports/commit/__tests__/savings.test.ts",
  "src/lib/imports/commit/__tests__/timing.test.ts",
  "src/lib/imports/commit/accounts.ts",
  "src/lib/imports/commit/family-resolver.ts",
  "src/lib/imports/commit/incomes.ts",
  "src/lib/imports/merge.ts",
  "src/lib/imports/owner-match.ts",
  "src/lib/imports/planner/__tests__/apply-decisions.test.ts",
  "src/lib/imports/planner/__tests__/fixtures/manifest.ts",
  "src/lib/imports/planner/__tests__/golden-assertions.test.ts",
  "src/lib/inline-edit/__tests__/owner-presets.test.ts",
  "src/lib/inline-edit/__tests__/scenario-fields.test.ts",
  "src/lib/inline-edit/scenario-fields.ts",
  "src/lib/insurance-policies/__tests__/disability-premium-expense.test.ts",
  "src/lib/insurance-policies/__tests__/owner-ref.test.ts",
  "src/lib/insurance-policies/__tests__/schedule-years.test.ts",
  "src/lib/intake/__tests__/diff.test.ts",
  "src/lib/life-insurance/__tests__/need-over-time.test.ts",
  "src/lib/observations/draft.ts",
  "src/lib/plan-text/observation-library.ts",
  "src/lib/plan-text/tokens.ts",
  "src/lib/portal/__tests__/greeting-name.test.ts",
  "src/lib/portal/__tests__/load-organizer-map.test.ts",
  "src/lib/portal/__tests__/load-profile-data.test.ts",
  "src/lib/portal/__tests__/portal-networth.test.ts",
  "src/lib/projection-explain/__tests__/explain.test.ts",
  "src/lib/projection-explain/__tests__/tax-detectors.test.ts",
  "src/lib/projection-explain/__tests__/tax-diff.test.ts",
  "src/lib/projection/resolve-entity.ts",
  "src/lib/quick-start/__tests__/insurance-save.test.ts",
  "src/lib/retirement/__tests__/derive-retirement-summary.test.ts",
  "src/lib/savings/__tests__/salary-options.test.ts",
  "src/lib/scenario/__tests__/scenario-changes-resolve.test.ts",
  "src/lib/scenario/describe-change-target.test.ts",
  "src/lib/schemas/__tests__/expenses.test.ts",
  "src/lib/schemas/__tests__/incomes.test.ts",
  "src/lib/schemas/__tests__/resources.test.ts",
  "src/lib/solver/__tests__/apply-mutations-disability-premium.test.ts",
  "src/lib/solver/__tests__/apply-mutations.test.ts",
  "src/lib/solver/__tests__/cashflow-year-detail.test.ts",
  "src/lib/solver/__tests__/mutations-to-scenario-changes.test.ts",
  "src/lib/tax-analysis/findings/business.ts",
  "src/lib/tax-analysis/findings/money-flags.ts",
  "src/lib/tax-ledger/build-diagnostics.test.ts",
  "src/lib/tax-reconciliation/__tests__/apply.test.ts",
  "src/lib/tax-reconciliation/__tests__/rules-assumptions.test.ts",
  "src/lib/tax-reconciliation/__tests__/rules-pensions.test.ts",
  "src/lib/tax-reconciliation/__tests__/rules-social-security.test.ts",
  "src/lib/tax-reconciliation/__tests__/rules-wages.test.ts",
  "src/lib/tax/__tests__/bracket.test.ts",
  "src/lib/tax/__tests__/derive-deductions.test.ts",
  "src/lib/tax/__tests__/senior-deductions.test.ts",
  "src/lib/tax/__tests__/thresholds.test.ts",
  "src/lib/tax/state-income/__tests__/compute.test.ts",
  "src/lib/tax/state-inheritance/__tests__/classify.test.ts",
  "src/lib/tax/state-inheritance/__tests__/special-rules.test.ts",
  "src/lib/tax/thresholds.ts",
  "src/lib/timeline/__tests__/detectors/life.test.ts",
]);/** A quoted string literal or a JSX text node — i.e. something a person reads.
 *  Matches case-insensitively.
 */
const DISPLAY = /("[^"\n]*\bspouse\b[^"\n]*")|('[^'\n]*\bspouse\b[^'\n]*')|(>[^<>{}\n]*\bspouse\b[^<>{}\n]*<)|(`[^`\n]*\bspouse\b[^`\n]*`)/gi;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : walk(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });
}

function isAllowlisted(f: string): boolean {
  if (PERMANENT_ALLOWLIST.has(f)) return true;
  if (ALLOWLIST_PREFIXES.some((prefix) => f.startsWith(prefix))) return true;
  return false;
}

function violations(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(DISPLAY)]
    .filter((m) => {
      const hit = m[0];

      // Exclude if matches TERMS_OF_ART
      if (TERMS_OF_ART.test(hit)) return false;

      // Extract the content without delimiters
      const content = hit.slice(1, -1);

      // Exclude if entire string is exactly the bare enum word "spouse" (lowercase only)
      if (content === "spouse") return false;

      // For lowercase "spouse", apply additional exclusions (c) and (d-new).
      // Only apply these rules if the hit contains lowercase "spouse" AND does not contain capitalized "Spouse".
      const hasLowercaseSpouse = /\bspouse\b/.test(hit);
      const hasCapitalizedSpouse = /\bSpouse\b/.test(hit);

      if (hasLowercaseSpouse && !hasCapitalizedSpouse) {
        // c. No space at all in the content (ids, slugs, CSS tokens like border-spouse/30)
        if (!content.includes(" ")) return false;

        // d-new. Match is directly adjacent to hyphen or underscore (fm-spouse, spouse_retirement, etc.)
        const charBefore = text[m.index - 1];
        const charAfter = text[m.index + hit.length];
        if (charBefore === "-" || charBefore === "_" || charAfter === "-" || charAfter === "_") {
          return false;
        }
      }

      return true;
    })
    .map((m) => m[0]);
}

describe("co-client terminology", () => {
  const files = walk(SRC)
    .map((f) => relative(process.cwd(), f))
    .filter((f) => !isAllowlisted(f));

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
