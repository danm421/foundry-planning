// src/lib/portal/goal-funding.ts
//
// "Percent funded" per goal, derived from the cash-flow projection. Pure — no
// IO, no React — so the rule can be unit-tested without a DB or a browser.
//
// The rule, in one paragraph. A projection year funds its expenses from the
// same inflow stack the Cash Flow report and the Retirement Analysis draw
// (`retirementInflows`): Social Security + salaries + other inflows + RMDs +
// supplemental withdrawals. When that total falls short of the year's
// expenses, the gap is real unfunded spending. `coverage` is the share of the
// year's expenses those inflows actually covered, and every goal active that
// year is funded pro-rata at that share. There is no per-expense priority in
// the engine — a shortfall year is short on *everything* — so a pro-rata split
// is the only allocation the projection actually supports.
//
// Education is the one exception, because the engine already answers the
// question exactly: a 529 pays the school straight out of the dedicated
// account without touching household cash (`dedicatedWithdrawal`, always
// funded), the uncovered remainder is either paid from household cash flow
// (`outOfPocketWithdrawal`, subject to that year's coverage) or booked as an
// unfunded `shortfall`. So education reads the engine's own numbers rather
// than the pro-rata rule.
//
// A goal expense the household does not pay — one owned by an entity or a
// business account — never lands in `expenses.bySource`, so it drops out of
// this list rather than reporting against a coverage figure derived from
// household cash it was never paid from.
import type { Account, ProjectionYear } from "@/engine/types";
import { isGoalExpense } from "@/lib/goals";
import { retirementInflows } from "@/lib/retirement/retirement-inflows";
import { lifetimeFunding } from "@/lib/retirement/retirement-funding";
import type { PortalGoalFunding, PortalGoalKind } from "@/lib/portal/contracts";

/** The subset of an engine `Expense` this module reads. */
export interface GoalFundingExpense {
  id: string;
  type: "living" | "other" | "insurance" | "education";
  name: string;
  isGoal?: boolean;
  forFamilyMemberId?: string | null;
}

export interface BuildGoalFundingInput {
  years: ProjectionYear[];
  /** Only used for the retirement line, via `lifetimeFunding`. */
  accounts: readonly Account[];
  expenses: GoalFundingExpense[];
  /** Beneficiary names for the "for <name>" line. */
  familyMemberNamesById: Map<string, string>;
  /** First retirement year, or null when the client has no date of birth. */
  retirementYear: number | null;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Share of a year's expenses the year's inflows actually covered, 0..1. */
export function yearCoverage(y: ProjectionYear): number {
  if (y.totalExpenses <= 0) return 1;
  return clamp01(retirementInflows(y).total / y.totalExpenses);
}

/** cost > 0 → funded/cost clamped to 0..1; a zero-cost goal reads as fully funded. */
function pct(funded: number, cost: number): number {
  if (cost <= 0) return 1;
  return clamp01(funded / cost);
}

interface Accumulator {
  cost: number;
  funded: number;
  startYear: number | null;
  endYear: number | null;
}

function emptyAccumulator(): Accumulator {
  return { cost: 0, funded: 0, startYear: null, endYear: null };
}

function addYear(acc: Accumulator, year: number, cost: number, funded: number): void {
  acc.cost += cost;
  acc.funded += funded;
  if (cost <= 0) return;
  // The goal's span is the years it actually costs money, not the stored
  // start/end — a goal clipped by the projection horizon should read as the
  // years the plan really funds.
  if (acc.startYear == null || year < acc.startYear) acc.startYear = year;
  if (acc.endYear == null || year > acc.endYear) acc.endYear = year;
}

/**
 * One line per goal: retirement first, then every education goal and every
 * expense the advisor flagged `isGoal`, ordered by the year funding starts.
 *
 * Goals the projection never reaches (no cost in any projected year) are
 * dropped rather than shown at 0% — a goal beyond the plan horizon is
 * unanswered, not unfunded.
 */
export function buildGoalFunding({
  years,
  accounts,
  expenses,
  familyMemberNamesById,
  retirementYear,
}: BuildGoalFundingInput): PortalGoalFunding[] {
  if (years.length === 0) return [];

  const coverageByYear = new Map<number, number>();
  for (const y of years) coverageByYear.set(y.year, yearCoverage(y));

  const goalExpenses = expenses.filter(isGoalExpense);
  const educationById = new Map(
    goalExpenses.filter((e) => e.type === "education").map((e) => [e.id, e]),
  );
  const otherGoals = goalExpenses.filter((e) => e.type !== "education");

  const accumulators = new Map<string, Accumulator>();
  const accFor = (id: string): Accumulator => {
    const existing = accumulators.get(id);
    if (existing) return existing;
    const fresh = emptyAccumulator();
    accumulators.set(id, fresh);
    return fresh;
  };

  for (const y of years) {
    const coverage = coverageByYear.get(y.year) ?? 1;

    for (const row of y.educationGoals ?? []) {
      // Accumulation rows are pre-expense funding-runway years — they carry no
      // goal cost, so folding them in would only widen the reported span.
      if (row.accumulation) continue;
      if (!educationById.has(row.goalId)) continue;
      addYear(
        accFor(row.goalId),
        y.year,
        row.goalExpense,
        row.dedicatedWithdrawal + row.outOfPocketWithdrawal * coverage,
      );
    }

    for (const e of otherGoals) {
      const cost = y.expenses.bySource[e.id] ?? 0;
      if (cost === 0) continue;
      addYear(accFor(e.id), y.year, cost, cost * coverage);
    }
  }

  const lines: PortalGoalFunding[] = [];

  // Retirement is the Retirement Summary report's own lifetime decomposition,
  // not a second aggregation over the same years — `lifetimeFunding` already
  // sums `totalExpenses` and the covered part of it from `retirementYear`
  // forward. Re-deriving it here would put a different percentage in front of
  // the client than the report puts in front of the advisor the moment the
  // inflow stack changes.
  if (retirementYear != null) {
    const f = lifetimeFunding(years, accounts, retirementYear);
    if (f.totalSpending > 0) {
      const funded = f.totalSpending - f.shortfall;
      const retirementYears = years.filter((y) => y.year >= retirementYear);
      lines.push({
        id: "retirement",
        kind: "retirement",
        label: "Retirement",
        forName: null,
        startYear: retirementYears[0]?.year ?? null,
        endYear: retirementYears[retirementYears.length - 1]?.year ?? null,
        cost: f.totalSpending,
        funded,
        pctFunded: pct(funded, f.totalSpending),
      });
    }
  }

  for (const e of goalExpenses) {
    const acc = accumulators.get(e.id);
    if (!acc || acc.cost <= 0) continue;
    const kind: PortalGoalKind = e.type === "education" ? "education" : "other";
    lines.push({
      id: e.id,
      kind,
      label: e.name,
      forName: e.forFamilyMemberId
        ? (familyMemberNamesById.get(e.forFamilyMemberId) ?? null)
        : null,
      startYear: acc.startYear,
      endYear: acc.endYear,
      cost: acc.cost,
      funded: acc.funded,
      pctFunded: pct(acc.funded, acc.cost),
    });
  }

  // Retirement pins to the top; the rest run in the order the plan funds them.
  return lines.sort((a, b) => {
    if (a.kind === "retirement") return -1;
    if (b.kind === "retirement") return 1;
    return (a.startYear ?? 0) - (b.startYear ?? 0);
  });
}
