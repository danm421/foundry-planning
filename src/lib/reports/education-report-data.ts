import type { EducationGoalYear, ProjectionYear } from "@/engine/types";

export interface EducationGoalReportRow extends EducationGoalYear {
  year: number;
}

export interface EducationGoalReport {
  goalId: string;
  name: string;
  rows: EducationGoalReportRow[];
  dedicatedFundsUsed: number;
  totalShortfall: number;
  chart: { labels: string[]; remaining: number[]; withdrawals: number[]; shortfall: number[] };
}

/** Group ProjectionYear.educationGoals into per-goal report bundles. */
export function buildEducationReport(
  years: ProjectionYear[],
  expenses: { id: string; name: string }[],
): EducationGoalReport[] {
  const nameById = new Map(expenses.map((e) => [e.id, e.name]));
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
    name: nameById.get(goalId) ?? "Education Goal",
    rows,
    dedicatedFundsUsed: rows.reduce((s, r) => s + r.dedicatedWithdrawal, 0),
    totalShortfall: rows.reduce((s, r) => s + r.shortfall, 0),
    chart: {
      labels: rows.map((r) => String(r.year)),
      remaining: rows.map((r) => r.dedicatedAssetsEOY),
      withdrawals: rows.map((r) => r.dedicatedWithdrawal),
      shortfall: rows.map((r) => r.shortfall),
    },
  }));
}
