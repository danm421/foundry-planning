// src/lib/quick-start/derive.ts
import {
  buildClientMilestones,
  resolveMilestone,
  defaultIncomeRefs,
  type ClientMilestones,
  type YearRef,
} from "@/lib/milestones";
import type { QsIncomeDraft, QsOwner } from "./types";

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
