// src/lib/household-map/goals.ts
import { coerceYearRef, resolveMilestone, type ClientMilestones } from "@/lib/milestones";

export type GoalKind = "education" | "purchase" | "household" | "retirement" | "plan_end";
export type GoalSide = "client" | "spouse" | "joint";

export interface MapGoal {
  /** Stable id: `expense:<uuid>` or `milestone:<slug>`. */
  id: string;
  year: number;
  kind: GoalKind;
  side: GoalSide;
  title: string;
  /** One-line supporting figure, e.g. "$38,000/yr · 2029–2032". */
  detail: string | null;
  /** The expense this card edits. Null for life milestones. */
  expenseId: string | null;
  forFamilyMemberName: string | null;
}

/** The subset of an engine Expense the Goals board needs. */
export interface GoalExpense {
  id: string;
  type: "living" | "other" | "insurance" | "education";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  startYearRef?: string | null;
  endYearRef?: string | null;
  isGoal?: boolean;
  forFamilyMemberId?: string | null;
  institutionName?: string | null;
}

export interface BuildMapGoalsInput {
  expenses: GoalExpense[];
  milestones: ClientMilestones;
  client: {
    firstName: string;
    retirementAge: number;
    lifeExpectancy: number;
    spouseFirstName: string | null;
    spouseRetirementAge: number | null;
    spouseLifeExpectancy: number | null;
  };
  familyMemberNamesById: ReadonlyMap<string, string>;
}

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Education is always a goal; everything else opts in via the isGoal flag. */
function isGoalRow(e: GoalExpense): boolean {
  return e.type === "education" || e.isGoal === true;
}

function kindOf(e: GoalExpense): GoalKind {
  if (e.type === "education") return "education";
  if (e.type === "other") return "purchase";
  return "household";
}

/** A goal's side follows its beneficiary when there is one, else the household. */
function sideOf(e: GoalExpense, input: BuildMapGoalsInput): GoalSide {
  if (!e.forFamilyMemberId) return "joint";
  // The beneficiary is usually a child; a child's goals hang on whichever
  // principal isn't the plan owner is arbitrary, so keep them joint. Only a
  // goal explicitly for a principal takes a side.
  const name = input.familyMemberNamesById.get(e.forFamilyMemberId);
  if (name && name === input.client.firstName) return "client";
  if (name && input.client.spouseFirstName && name === input.client.spouseFirstName) {
    return "spouse";
  }
  return "joint";
}

function detailOf(e: GoalExpense, year: number, endYear: number): string {
  const amount = currency.format(e.annualAmount);
  const span = endYear > year ? `${year}–${endYear}` : `${year}`;
  const perYear = endYear > year ? `${amount}/yr` : amount;
  return `${perYear} · ${span}`;
}

/**
 * Build the Goals board's cards from three sources:
 *   1. expenses flagged `isGoal`
 *   2. every education expense, flag or not
 *   3. the three life milestones (client retirement, spouse retirement, plan end)
 *
 * Years come from `resolveMilestone` when the row is milestone-anchored, so a
 * goal pinned to "at retirement" moves when the retirement age moves.
 *
 * Pure. No IO.
 */
export function buildMapGoals(input: BuildMapGoalsInput): MapGoal[] {
  const { milestones: m, client } = input;
  const goals: MapGoal[] = [];

  // --- 1 & 2: expense-backed goals ---
  for (const e of input.expenses) {
    if (!isGoalRow(e)) continue;

    const startRef = coerceYearRef(e.startYearRef);
    const endRef = coerceYearRef(e.endYearRef);
    const year = (startRef && resolveMilestone(startRef, m, "start")) ?? e.startYear;
    const endYear = (endRef && resolveMilestone(endRef, m, "end")) ?? e.endYear;

    goals.push({
      id: `expense:${e.id}`,
      year,
      kind: kindOf(e),
      side: sideOf(e, input),
      title: e.institutionName ? `${e.name} · ${e.institutionName}` : e.name,
      detail: detailOf(e, year, endYear),
      expenseId: e.id,
      forFamilyMemberName: e.forFamilyMemberId
        ? (input.familyMemberNamesById.get(e.forFamilyMemberId) ?? null)
        : null,
    });
  }

  // --- 3: life milestones ---
  goals.push({
    id: "milestone:client_retirement",
    year: m.clientRetirement,
    kind: "retirement",
    side: "client",
    title: `${client.firstName} retires`,
    detail: `age ${client.retirementAge}`,
    expenseId: null,
    forFamilyMemberName: null,
  });

  if (m.spouseRetirement != null && client.spouseFirstName && client.spouseRetirementAge != null) {
    goals.push({
      id: "milestone:spouse_retirement",
      year: m.spouseRetirement,
      kind: "retirement",
      side: "spouse",
      title: `${client.spouseFirstName} retires`,
      detail: `age ${client.spouseRetirementAge}`,
      expenseId: null,
      forFamilyMemberName: null,
    });
  }

  // Plan end is the later of the two projected deaths, attributed to whoever
  // set it. `spouseEnd` is undefined for a single client.
  const spouseEnd = m.spouseEnd ?? -Infinity;
  const spouseOutlives = spouseEnd > m.clientEnd;
  const planEndAge = spouseOutlives ? client.spouseLifeExpectancy : client.lifeExpectancy;
  goals.push({
    id: "milestone:plan_end",
    year: spouseOutlives ? spouseEnd : m.clientEnd,
    kind: "plan_end",
    side: spouseOutlives ? "spouse" : "client",
    title: spouseOutlives
      ? `${client.spouseFirstName}'s life expectancy`
      : `${client.firstName}'s life expectancy`,
    detail: planEndAge != null ? `age ${planEndAge}` : null,
    expenseId: null,
    forFamilyMemberName: null,
  });

  return goals.sort((a, b) => a.year - b.year || a.id.localeCompare(b.id));
}
