import type { GoalYear, ProjectionYear } from "@/engine/types";
import { yearCoverage } from "@/lib/portal/goal-funding";

export interface GoalReportRow extends GoalYear {
  year: number;
}

export interface GoalReport {
  goalId: string;
  name: string;
  rows: GoalReportRow[];
  dedicatedFundsUsed: number;
  /** Total funded from household cash flow (out-of-pocket) across the goal. */
  cashFlowFundsUsed: number;
  totalShortfall: number;
  /** Indexed cost of the goal across every expense year — the denominator for
   *  "% funded". Zero while the goal is still in accumulation. */
  totalGoalCost: number;
  chart: {
    labels: string[];
    remaining: number[];
    withdrawals: number[];
    outOfPocket: number[];
    shortfall: number[];
  };
}

/** Group ProjectionYear.goals into per-goal report bundles. */
export function buildGoalReport(
  years: ProjectionYear[],
  expenses: { id: string; name: string }[],
): GoalReport[] {
  const byId = new Map(expenses.map((e) => [e.id, e]));
  const byGoal = new Map<string, GoalReportRow[]>();
  for (const y of years) {
    for (const g of y.goals ?? []) {
      const arr = byGoal.get(g.goalId) ?? [];
      arr.push({ ...g, year: y.year });
      byGoal.set(g.goalId, arr);
    }
  }
  return [...byGoal.entries()].map(([goalId, rows]) => ({
    goalId,
    name: byId.get(goalId)?.name ?? "Goal",
    rows,
    dedicatedFundsUsed: rows.reduce((s, r) => s + r.dedicatedWithdrawal, 0),
    cashFlowFundsUsed: rows.reduce((s, r) => s + (r.outOfPocketWithdrawal ?? 0), 0),
    totalShortfall: rows.reduce((s, r) => s + r.shortfall, 0),
    totalGoalCost: rows.reduce((s, r) => s + r.goalExpense, 0),
    chart: {
      labels: rows.map((r) => String(r.year)),
      remaining: rows.map((r) => r.dedicatedAssetsEOY),
      withdrawals: rows.map((r) => r.dedicatedWithdrawal),
      outOfPocket: rows.map((r) => r.outOfPocketWithdrawal ?? 0),
      shortfall: rows.map((r) => r.shortfall),
    },
  }));
}

/** A goal with no savings account behind it — an Other goal paid from cash
 *  flow as a plain expense, so it has no goal rows. */
export interface CashFlowGoalReport {
  goalId: string;
  name: string;
  rows: { year: number; cost: number; funded: number }[];
  totalCost: number;
  totalFunded: number;
}

/** Cost per year is the goal's expense line (`expenses.bySource`); the share
 *  funded is that year's coverage — the client portal's rule (`yearCoverage`),
 *  reused so the Goals report and the portal can't show two percentages for
 *  one goal. A goal with no cost in any projected year is left out. */
export function buildCashFlowGoalReports(
  years: ProjectionYear[],
  goals: ReadonlyArray<{ id: string; name: string }>,
): CashFlowGoalReport[] {
  const out: CashFlowGoalReport[] = [];
  for (const g of goals) {
    const rows = years.flatMap((y) => {
      const cost = y.expenses.bySource[g.id] ?? 0;
      return cost > 0 ? [{ year: y.year, cost, funded: cost * yearCoverage(y) }] : [];
    });
    if (rows.length === 0) continue;
    out.push({
      goalId: g.id,
      name: g.name,
      rows,
      totalCost: rows.reduce((s, r) => s + r.cost, 0),
      totalFunded: rows.reduce((s, r) => s + r.funded, 0),
    });
  }
  return out;
}
