// src/lib/imports/planner/apply-decisions.ts
//
// Pure fold: turns a `PlanningDecisions` (Task 13's bounded planner loop
// output) into writes on an `ImportPayload`. No IO, no Date.now, no
// Math.random - every id and value is derived from the decisions and the
// existing payload. The caller (Task 15's assemble wiring) owns everything
// non-deterministic (when to run the planner, what to do with its output).
import type { ExtractedExpense, ExtractedSavings } from "@/lib/extraction/types";
import type { Annotated, ImportPayload } from "../types";
import { emptyPlanBasics } from "../assemble/plan-basics";
import { emptyGoals, goalId } from "../assemble/goals";
import type { AssembleGoals, AssemblePlanBasics, AssembleQuestion, EducationGoal, PlanBasicsField } from "../assemble/types";
import { blank } from "../assemble/field";
import type { Decision, GoalDecision, PlanningDecisions, SavingsDecision } from "./types";

export interface ApplyDecisionsInput {
  payload: ImportPayload;
  decisions: PlanningDecisions;
  known: { primaryDob?: string; spouseDob?: string; hasSpouse: boolean };
}

export interface ApplyDecisionsResult {
  payload: ImportPayload;
  questions: AssembleQuestion[];
  notes: string[];
}

/** Case-insensitive, punctuation-stripped comparison key for an account name. */
function accountKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Rule 1 for a REQUIRED `AssemblePlanBasics` field: never overwrite "stated". */
function applyRequiredField<T>(
  existing: PlanBasicsField<T>,
  decision: Decision<T> | undefined,
): PlanBasicsField<T> {
  if (!decision || existing.provenance === "stated") return existing;
  return { value: decision.value, provenance: decision.provenance, reason: decision.reason };
}

/** Rule 1 for an OPTIONAL `AssemblePlanBasics` field (the spouse variants). */
function applyOptionalField<T>(
  existing: PlanBasicsField<T> | undefined,
  decision: Decision<T> | undefined,
): PlanBasicsField<T> | undefined {
  if (!decision || existing?.provenance === "stated") return existing;
  return { value: decision.value, provenance: decision.provenance, reason: decision.reason };
}

/** Copy a `Decision<T>`'s three carried fields into a `PlanBasicsField<T>`, dropping `sourceQuote`. */
function toPlanBasicsField<T>(decision: Decision<T>): PlanBasicsField<T> {
  return { value: decision.value, provenance: decision.provenance, reason: decision.reason };
}

function buildSavingsRow(decision: SavingsDecision): Annotated<ExtractedSavings> {
  return {
    name: decision.accountName,
    destinationAccountName: decision.accountName,
    owner: decision.owner,
    annualPercent: decision.annualPercent?.value,
    annualAmount: decision.annualAmount?.value,
    employerMatchPct: decision.employerMatchPct?.value,
    employerMatchCap: decision.employerMatchCap?.value,
    rothPercent: decision.rothPercent?.value,
    match: { kind: "new" },
  };
}

/**
 * `GoalDecision.endYear` is an absolute calendar year; `EducationGoal.years`
 * is a duration count. Both ends are inclusive (the same "Ends: After N
 * Years" convention the planner's goals prompt already uses elsewhere in
 * this feature - a 1-year span has endYear === startYear), so the count is
 * `endYear - startYear + 1`.
 */
function deriveEducationGoal(decision: GoalDecision): EducationGoal {
  return {
    id: goalId(decision.name.value),
    name: toPlanBasicsField(decision.name),
    forFamilyMemberName: decision.forFamilyMemberName
      ? toPlanBasicsField(decision.forFamilyMemberName)
      : blank<string>(),
    annualAmount: toPlanBasicsField(decision.annualAmount),
    startYear: toPlanBasicsField(decision.startYear),
    years: {
      value: decision.endYear.value - decision.startYear.value + 1,
      provenance: "derived",
      reason: `Computed from the decision's start year (${decision.startYear.value}) and end year (${decision.endYear.value}).`,
    },
    growthRate: decision.growthRate ? toPlanBasicsField(decision.growthRate) : blank<number>(),
    // No decision field carries evidence for this - blank+derived per the
    // same "derive from evidence, or go blank" rule `derivePlanBasics` follows.
    payShortfallOutOfPocket: blank<boolean>(),
    dedicatedAccountNames: decision.dedicatedAccountNames,
  };
}

function buildExpenseRow(decision: GoalDecision): Annotated<ExtractedExpense> {
  return {
    type: "other",
    name: decision.name.value,
    annualAmount: decision.annualAmount.value,
    startYear: decision.startYear.value,
    endYear: decision.endYear.value,
    growthRate: decision.growthRate?.value,
    match: { kind: "new" },
  };
}

export function applyDecisions(input: ApplyDecisionsInput): ApplyDecisionsResult {
  const { payload, decisions } = input;

  // ── Rule 1: assumptions -> planBasics ──
  const baseBasics = payload.planBasics ?? emptyPlanBasics();
  const { assumptions } = decisions;

  // ── Rule 3: social security -> planBasics.socialSecurity (one entry per owner) ──
  const decidedOwners = new Set(decisions.socialSecurity.map((d) => d.owner));
  const socialSecurity: AssemblePlanBasics["socialSecurity"] = [
    ...baseBasics.socialSecurity.filter((entry) => !decidedOwners.has(entry.owner)),
    ...decisions.socialSecurity.map((d) => ({
      owner: d.owner,
      pia: toPlanBasicsField(d.piaMonthly),
      claimingAge: toPlanBasicsField(d.claimingAge),
    })),
  ];

  const planBasics: AssemblePlanBasics = {
    ...baseBasics,
    retirementAge: applyRequiredField(baseBasics.retirementAge, assumptions.retirementAge),
    lifeExpectancy: applyRequiredField(baseBasics.lifeExpectancy, assumptions.lifeExpectancy),
    currentLivingSpending: applyRequiredField(baseBasics.currentLivingSpending, assumptions.currentLivingSpending),
    retirementLivingSpending: applyRequiredField(baseBasics.retirementLivingSpending, assumptions.retirementLivingSpending),
    spouseRetirementAge: applyOptionalField(baseBasics.spouseRetirementAge, assumptions.spouseRetirementAge),
    spouseLifeExpectancy: applyOptionalField(baseBasics.spouseLifeExpectancy, assumptions.spouseLifeExpectancy),
    socialSecurity,
  };
  // `assumptions.inflationRate` has no matching field anywhere in the
  // payload (no inflation slot exists at all) - like Rule 5's "override
  // naming no existing row is ignored", there is nothing to write it onto,
  // so it is dropped here. `assumptions.riskTolerance` DOES have a target -
  // `AssembleGoals.riskTolerance` - and is wired in the Rule 4 block below.

  // ── Rule 2: savings decisions replace matching extracted rows by name ──
  const decidedAccountKeys = new Set(decisions.savings.map((d) => accountKey(d.accountName)));
  const savings: Annotated<ExtractedSavings>[] = [
    ...payload.savings.filter((row) => !decidedAccountKeys.has(accountKey(row.destinationAccountName))),
    ...decisions.savings.map(buildSavingsRow),
  ];

  // ── Rule 4: goals -> education goals + "other" expenses ──
  const educationDecisions = decisions.goals.filter((g) => g.kind === "education");
  const expenseDecisions = decisions.goals.filter((g) => g.kind !== "education");

  const baseGoals = payload.goals ?? emptyGoals();
  const goals: AssembleGoals = {
    ...baseGoals,
    education: [...baseGoals.education, ...educationDecisions.map(deriveEducationGoal)],
    // riskTolerance is advisor-editable in the Goals step, so it goes
    // through the same "never overwrite 'stated'" guard as Rule 1's
    // planBasics fields, reusing that guard rather than a second copy of it.
    riskTolerance: applyRequiredField(baseGoals.riskTolerance, assumptions.riskTolerance),
  };
  const expenses: Annotated<ExtractedExpense>[] = [...payload.expenses, ...expenseDecisions.map(buildExpenseRow)];

  // ── Rule 5: income timing overrides by exact name match ──
  const incomes = payload.incomes.map((row) => {
    const override = decisions.incomeTiming.find((o) => o.incomeName === row.name);
    if (!override) return row;
    // Clear the stale concrete year so the new ref wins in resolveImportTiming
    // (set to undefined rather than destructure-dropped - exactOptionalPropertyTypes
    // is off, so this is equivalent and avoids an unused-binding lint warning).
    return { ...row, endYearRef: override.endYearRef.value, endYear: undefined };
  });

  // ── Rule 6: planner questions -> assemble questions ──
  const questions: AssembleQuestion[] = decisions.questions.map((q) => ({
    id: q.id,
    kind: "missing",
    field: q.field,
    prompt: q.prompt,
    options: q.options,
  }));

  return {
    payload: { ...payload, planBasics, savings, goals, expenses, incomes },
    questions,
    // Rule 7: notes pass through unchanged. Copied to keep the result
    // independent of `decisions.notes`'s own array identity.
    notes: [...decisions.notes],
  };
}
