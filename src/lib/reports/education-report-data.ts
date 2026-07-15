import type { EducationGoalYear, ProjectionYear } from "@/engine/types";

export interface EducationGoalReportRow extends EducationGoalYear {
  year: number;
}

export interface EducationGoalReport {
  goalId: string;
  name: string;
  rows: EducationGoalReportRow[];
  dedicatedFundsUsed: number;
  /** Total funded from household cash flow (out-of-pocket) across the goal. */
  cashFlowFundsUsed: number;
  totalShortfall: number;
  /** The goal pays any uncovered cost from household cash flow (its
   *  `payShortfallOutOfPocket` setting). When true, cash flow is an available
   *  funding source, so the per-goal success gauge treats a dedicated-pool
   *  shortfall as covered rather than as a failure. */
  coveredByCashFlow: boolean;
  chart: {
    labels: string[];
    remaining: number[];
    withdrawals: number[];
    outOfPocket: number[];
    shortfall: number[];
  };
}

/** Group ProjectionYear.educationGoals into per-goal report bundles. */
export function buildEducationReport(
  years: ProjectionYear[],
  expenses: { id: string; name: string; payShortfallOutOfPocket?: boolean }[],
): EducationGoalReport[] {
  const byId = new Map(expenses.map((e) => [e.id, e]));
  const byGoal = new Map<string, EducationGoalReportRow[]>();
  for (const y of years) {
    for (const g of y.educationGoals ?? []) {
      const arr = byGoal.get(g.goalId) ?? [];
      arr.push({ ...g, year: y.year });
      byGoal.set(g.goalId, arr);
    }
  }
  return [...byGoal.entries()].map(([goalId, rows]) => ({
    goalId,
    name: byId.get(goalId)?.name ?? "Education Goal",
    rows,
    dedicatedFundsUsed: rows.reduce((s, r) => s + r.dedicatedWithdrawal, 0),
    cashFlowFundsUsed: rows.reduce((s, r) => s + (r.outOfPocketWithdrawal ?? 0), 0),
    totalShortfall: rows.reduce((s, r) => s + r.shortfall, 0),
    coveredByCashFlow: byId.get(goalId)?.payShortfallOutOfPocket ?? false,
    chart: {
      labels: rows.map((r) => String(r.year)),
      remaining: rows.map((r) => r.dedicatedAssetsEOY),
      withdrawals: rows.map((r) => r.dedicatedWithdrawal),
      outOfPocket: rows.map((r) => r.outOfPocketWithdrawal ?? 0),
      shortfall: rows.map((r) => r.shortfall),
    },
  }));
}
