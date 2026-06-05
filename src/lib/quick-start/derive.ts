// src/lib/quick-start/derive.ts
import {
  buildClientMilestones,
  resolveMilestone,
  defaultIncomeRefs,
  defaultExpenseRefs,
  type ClientMilestones,
  type YearRef,
} from "@/lib/milestones";
import { defaultDeductibleForSubtype } from "@/components/forms/deductible-contribution-checkbox";
import type { USPSStateCode } from "@/lib/usps-states";
import type {
  QsIncomeDraft,
  QsOwner,
  QsAccountDraft,
  QsLiabilityDraft,
  QsOtherExpenseDraft,
  QsSavingsDraft,
  QsInsuranceDraft,
  QsAssumptionsDraft,
} from "./types";

export interface QsContext {
  milestones: ClientMilestones;
  planStartYear: number;
  planEndYear: number;
  clientFirstName: string;
  spouseFirstName: string | null;
  hasSpouse: boolean;
}

export function buildQsContext(input: {
  client: {
    dateOfBirth: string;
    retirementAge: number;
    planEndAge: number;
    spouseDob?: string | null;
    spouseRetirementAge?: number | null;
  };
  planStartYear: number;
  planEndYear: number;
  clientFirstName: string;
  spouseFirstName: string | null;
  hasSpouse: boolean;
}): QsContext {
  const milestones = buildClientMilestones(
    {
      dateOfBirth: input.client.dateOfBirth,
      retirementAge: input.client.retirementAge,
      planEndAge: input.client.planEndAge,
      spouseDob: input.client.spouseDob ?? null,
      spouseRetirementAge: input.client.spouseRetirementAge ?? null,
    },
    input.planStartYear,
    input.planEndYear,
  );
  return {
    milestones,
    planStartYear: input.planStartYear,
    planEndYear: input.planEndYear,
    clientFirstName: input.clientFirstName,
    spouseFirstName: input.spouseFirstName,
    hasSpouse: input.hasSpouse,
  };
}

function ownerFirstName(owner: QsOwner, ctx: QsContext): string {
  if (owner === "spouse") return ctx.spouseFirstName ?? "Spouse";
  if (owner === "joint") return "Joint";
  return ctx.clientFirstName;
}

/** Replicates the trivial private label helpers in income-expenses-view.tsx. */
function incomeLabel(kind: QsIncomeDraft["kind"]): string {
  switch (kind) {
    case "salary":
      return "Salary";
    case "pension":
      return "Pension";
    case "social_security":
      return "Social Security";
    case "other":
      return "Other income";
  }
}

function resolveYear(
  ref: YearRef | null,
  fallback: number,
  ctx: QsContext,
  position: "start" | "end",
): number {
  if (!ref) return fallback;
  const y = resolveMilestone(ref, ctx.milestones, position);
  return y ?? fallback;
}

export interface IncomePostBody {
  type: string;
  name: string;
  owner: QsOwner;
  annualAmount: number;
  startYear: number;
  endYear: number;
  startYearRef: YearRef | null;
  endYearRef: YearRef | null;
  taxType: string;
  growthRate: string;
  growthSource: "inflation" | "custom";
  ssBenefitMode?: string;
  piaMonthly?: number;
  claimingAge?: number;
  claimingAgeMonths?: number;
}

export function incomePayload(draft: QsIncomeDraft, ctx: QsContext): IncomePostBody {
  const first = ownerFirstName(draft.owner, ctx);
  const name = `${first} - ${incomeLabel(draft.kind)}`;

  if (draft.kind === "social_security") {
    const refs = defaultIncomeRefs("social_security", draft.owner);
    return {
      type: "social_security",
      name,
      owner: draft.owner,
      annualAmount: 0,
      startYear: draft.startYear ?? resolveYear(refs.startYearRef, ctx.planStartYear, ctx, "start"),
      endYear: draft.endYear ?? resolveYear(refs.endYearRef, ctx.planEndYear, ctx, "end"),
      startYearRef: refs.startYearRef,
      endYearRef: refs.endYearRef,
      taxType: "ordinary_income",
      growthRate: "0.03",
      growthSource: "custom",
      ssBenefitMode: "pia_at_fra",
      piaMonthly: draft.monthlyBenefit ?? 0,
      claimingAge: draft.claimingAge ?? 67,
      claimingAgeMonths: 0,
    };
  }

  // salary | pension | other
  const engineType =
    draft.kind === "pension" ? "deferred" : draft.kind === "salary" ? "salary" : "other";
  const refs = defaultIncomeRefs(engineType, draft.owner);
  const taxType =
    draft.taxType ?? (draft.kind === "salary" ? "earned_income" : "ordinary_income");
  const noCola = draft.kind === "pension";
  return {
    type: engineType,
    name,
    owner: draft.owner,
    annualAmount: draft.amount ?? 0,
    startYear: draft.startYear ?? resolveYear(refs.startYearRef, ctx.planStartYear, ctx, "start"),
    endYear: draft.endYear ?? resolveYear(refs.endYearRef, ctx.planEndYear, ctx, "end"),
    startYearRef: refs.startYearRef,
    endYearRef: refs.endYearRef,
    taxType,
    growthRate: noCola ? "0" : "0.03",
    growthSource: noCola ? "custom" : "inflation",
  };
}

/** Maps a monthly-benefit + whole-year claiming age to the income route's SS fields. */
export function ssPatch(input: { monthlyBenefit?: number; claimingAge?: number }) {
  return {
    ssBenefitMode: "pia_at_fra" as const,
    piaMonthly: input.monthlyBenefit ?? 0,
    claimingAge: input.claimingAge ?? 67,
    claimingAgeMonths: 0,
  };
}

export const ACCOUNT_LABEL: Record<QsAccountDraft["kind"], string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  real_estate: "Real estate",
};
export const RETIREMENT_LABEL: Record<NonNullable<QsAccountDraft["subType"]>, string> = {
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  "403b": "403(b)",
};

export function accountPayload(draft: QsAccountDraft, ctx: QsContext) {
  const first = ownerFirstName(draft.owner, ctx);
  let category: string;
  let subType: string;
  let basis: number;
  switch (draft.kind) {
    case "cash":
      category = "cash";
      subType = "savings";
      basis = draft.value;
      break;
    case "taxable":
      category = "taxable";
      subType = "brokerage";
      basis = draft.basis ?? draft.value;
      break;
    case "retirement":
      category = "retirement";
      subType = draft.subType ?? "traditional_ira";
      basis = 0;
      break;
    case "real_estate":
      category = "real_estate";
      subType = "primary_residence";
      basis = draft.basis ?? draft.value;
      break;
  }
  const label =
    draft.kind === "retirement" && draft.subType
      ? RETIREMENT_LABEL[draft.subType]
      : ACCOUNT_LABEL[draft.kind];
  return {
    name: `${first} - ${label}`,
    category,
    subType,
    owner: draft.owner,
    value: draft.value,
    basis,
    rothValue: 0,
    // growthRate omitted (null) => inherits category default from plan settings
  };
}

/** Standard amortized monthly payment. */
function amortizedPayment(principal: number, annualRate: number, months: number): number {
  if (months <= 0) return 0;
  const r = annualRate / 12;
  if (r === 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export function liabilityPayload(draft: QsLiabilityDraft, ctx: QsContext) {
  const termMonths = (draft.termYears ?? 0) * 12;
  const monthly =
    draft.monthlyPayment ?? amortizedPayment(draft.balance, draft.interestRate, termMonths);
  return {
    name: draft.name,
    balance: draft.balance,
    interestRate: draft.interestRate,
    monthlyPayment: monthly,
    startYear: ctx.planStartYear,
    startMonth: 1,
    termMonths,
    termUnit: "monthly",
    isInterestDeductible: false,
  };
}

export function otherExpensePayload(draft: QsOtherExpenseDraft, ctx: QsContext) {
  const refs = defaultExpenseRefs("other");
  return {
    type: "other",
    name: draft.name || "Other expense",
    annualAmount: draft.amount,
    startYear: draft.startYear ?? resolveYear(refs.startYearRef, ctx.planStartYear, ctx, "start"),
    endYear: draft.endYear ?? resolveYear(refs.endYearRef, ctx.planEndYear, ctx, "end"),
    startYearRef: refs.startYearRef,
    endYearRef: refs.endYearRef,
    growthRate: "0.03",
    growthSource: "inflation" as const,
  };
}

/**
 * Defensive fallback for the Expenses step when a seeded living-expense stub is
 * missing — builds the same current/retirement phase row the client seeder makes.
 */
export function livingExpensePayload(
  phase: "current" | "retirement",
  amount: number,
  ctx: QsContext,
) {
  if (phase === "current") {
    return {
      type: "living",
      name: "Current Living Expenses",
      annualAmount: amount,
      startYear: ctx.planStartYear,
      endYear: resolveMilestone("client_retirement", ctx.milestones, "end") ?? ctx.planEndYear,
      startYearRef: "plan_start" as const,
      endYearRef: "client_retirement" as const,
      growthRate: "0.03",
      growthSource: "inflation" as const,
    };
  }
  return {
    type: "living",
    name: "Retirement Living Expenses",
    annualAmount: amount,
    startYear: resolveMilestone("client_retirement", ctx.milestones, "start") ?? ctx.planStartYear,
    endYear: ctx.planEndYear,
    startYearRef: "client_retirement" as const,
    endYearRef: "plan_end" as const,
    growthRate: "0.03",
    growthSource: "inflation" as const,
  };
}

export function savingsPayload(draft: QsSavingsDraft, ctx: QsContext) {
  const startYear = draft.startYear ?? ctx.planStartYear;
  const endYear =
    draft.endYear ?? resolveMilestone("client_retirement", ctx.milestones, "end") ?? ctx.planEndYear;
  return {
    accountId: draft.accountId,
    startYear,
    endYear,
    annualAmount: draft.mode === "fixed" ? draft.amount ?? 0 : 0,
    annualPercent: draft.mode === "percent" ? draft.percent ?? null : null,
    contributeMax: draft.mode === "max",
    applyContributionLimit: true,
    isDeductible:
      draft.accountCategory === "retirement"
        ? defaultDeductibleForSubtype(draft.accountSubType)
        : false,
    rothPercent: draft.roth ? 1 : null,
    growthSource: draft.growthInflation ? ("inflation" as const) : ("custom" as const),
    employerMatchPct: draft.matchMode === "percent" ? draft.matchPercent ?? null : null,
    employerMatchCap: draft.matchMode === "percent" ? draft.matchCap ?? null : null,
    employerMatchAmount: draft.matchMode === "fixed" ? draft.matchAmount ?? null : null,
  };
}

export const POLICY_LABEL: Record<QsInsuranceDraft["policyType"], string> = {
  term: "Term",
  whole: "Whole",
  universal: "Universal",
};

export function insurancePayload(
  draft: QsInsuranceDraft,
  ctx: QsContext,
  ownerFamilyMemberId?: string | null,
) {
  const first = draft.insured === "spouse" ? ctx.spouseFirstName ?? "Spouse" : ctx.clientFirstName;
  const isTerm = draft.policyType === "term";
  return {
    name: `${first} - ${POLICY_LABEL[draft.policyType]} Life`,
    policyType: draft.policyType,
    insuredPerson: draft.insured,
    // Single insured => the insured family member owns the policy.
    ownerRef: { kind: "family" as const, id: ownerFamilyMemberId ?? undefined },
    faceValue: draft.faceValue,
    premiumAmount: draft.premiumAmount,
    premiumYears: draft.premiumYears ?? null,
    termIssueYear: isTerm ? draft.termIssueYear ?? ctx.planStartYear : null,
    termLengthYears:
      isTerm && !draft.endsAtInsuredRetirement ? draft.termLengthYears ?? null : null,
    endsAtInsuredRetirement: draft.endsAtInsuredRetirement ?? false,
    cashValueGrowthMode: "basic" as const,
  };
}

export function planSettingsPayload(
  draft: QsAssumptionsDraft,
  residenceState: USPSStateCode | null,
) {
  const common = {
    inflationRate: draft.inflationRate,
    defaultGrowthTaxable: draft.growthTaxable,
    defaultGrowthCash: draft.growthCash,
    defaultGrowthRetirement: draft.growthRetirement,
    defaultGrowthRealEstate: draft.growthRealEstate,
    defaultGrowthLifeInsurance: draft.growthLifeInsurance,
  };
  if (draft.taxMode === "brackets") {
    return { ...common, taxEngineMode: "bracket" as const, residenceState };
  }
  return {
    ...common,
    taxEngineMode: "flat" as const,
    flatFederalRate: draft.flatFederalRate ?? 0.22,
    flatStateRate: draft.flatStateRate ?? 0.05,
  };
}
