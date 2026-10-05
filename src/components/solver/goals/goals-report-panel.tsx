"use client";

import { useMemo } from "react";
import type { ProjectionYear } from "@/engine/types";
import {
  buildGoalReport,
  buildCashFlowGoalReports,
  type CashFlowGoalReport,
  type GoalReport,
} from "@/lib/reports/goal-report-data";
import { buildGoalMcInput, type GoalReturnStat } from "@/lib/reports/goal-mc-inputs";
import { isMaterialShortfall } from "@/lib/retirement/retirement-inflows";
import { runGoalMc } from "@/engine/goals/goal-mc";
import { GoalChart } from "@/components/charts/goal-chart";
import { AnalysisYearTable } from "@/components/scenario/year-table";
import { goalYearColumns, cashFlowGoalYearColumns } from "@/components/scenario/goal-year-columns";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { SolverPosGauge } from "@/app/(app)/clients/[id]/solver/solver-pos-gauge";

// Neutral blended-return fallback for a goal with no server-supplied stats
// (e.g. a goal added live in the solver, or a zero-balance dedicated pool).
// A moderate-growth, moderate-volatility index — keeps the gauge directional.
const FALLBACK_RETURN_STAT: GoalReturnStat = { arithMean: 0.06, stdDev: 0.12 };
// Stable default seed so the gauge is deterministic when the solver hasn't
// supplied the scenario's own Monte Carlo seed (never Math.random/Date).
const DEFAULT_GOAL_SEED = 1;

/** Share of the goal's indexed cost that got funded — from any source. Derived
 *  from the shortfall rather than from the withdrawals so a fully funded goal
 *  reads exactly 100% (the two sums are floats). Rounds DOWN whenever anything
 *  is unfunded, so the headline never says 100% next to a live shortfall. */
function fundedLabel(totalGoalCost: number, totalShortfall: number): string {
  if (totalGoalCost <= 0) return "—";
  const pct = (1 - totalShortfall / totalGoalCost) * 100;
  return `${totalShortfall > 0 ? Math.floor(pct) : Math.round(pct)}%`;
}

/** What a cash-flow goal left unfunded. Coverage comes from two float sums, so
 *  a year the plan funds exactly can land a hair short of 1; that residue reads
 *  as nothing (`isMaterialShortfall`), and the label and its colour both ask it. */
function cashFlowShortfall(r: CashFlowGoalReport): number {
  const unfunded = Math.max(0, r.totalCost - r.totalFunded);
  return isMaterialShortfall(unfunded) ? unfunded : 0;
}

/** The expense fields this panel reads. */
export interface GoalsReportExpense {
  id: string;
  name: string;
  type: string;
  isGoal?: boolean;
}

interface Props {
  years: ProjectionYear[];
  expenses: GoalsReportExpense[];
  /** Blended dedicated-pool return stats per goalId, from the solver's plan MC
   *  data. Optional — goals without an entry use FALLBACK_RETURN_STAT. */
  returnStats?: Record<string, GoalReturnStat>;
  /** Scenario Monte Carlo seed, for reproducible per-goal gauges. */
  seed?: number;
}

type Section =
  | { kind: "funded"; firstYear: number; report: GoalReport }
  | { kind: "cashFlow"; firstYear: number; report: CashFlowGoalReport };

export function GoalsReportPanel({ years, expenses, returnStats, seed }: Props) {
  const reports = useMemo(() => buildGoalReport(years, expenses), [years, expenses]);
  // Other goals with no savings account are plain expenses paid from cash flow,
  // so the projection writes no goal rows for them (spec 2026-10-05, §3).
  const cashFlowReports = useMemo(() => {
    const funded = new Set(reports.map((r) => r.goalId));
    return buildCashFlowGoalReports(
      years,
      expenses.filter((e) => e.type === "other" && e.isGoal === true && !funded.has(e.id)),
    );
  }, [years, expenses, reports]);
  const columns = useMemo(() => goalYearColumns(), []);
  const cashFlowColumns = useMemo(() => cashFlowGoalYearColumns(), []);

  // Per-goal probability the SAVINGS cover the goal (Decision 7): simulate the
  // dedicated pool's stochastic balance path against the goal's yearly cost.
  // Cheap (a single blended index, no runProjection), so it runs client-side.
  const mcSeed = seed ?? DEFAULT_GOAL_SEED;
  const successByGoal = useMemo(() => {
    const stats = returnStats ?? {};
    const out: Record<string, number> = {};
    for (const r of reports) {
      const goalStats = stats[r.goalId] ?? FALLBACK_RETURN_STAT;
      out[r.goalId] = runGoalMc(buildGoalMcInput(r, goalStats, mcSeed)).successRate;
    }
    return out;
  }, [reports, returnStats, mcSeed]);

  const sections: Section[] = [
    ...reports.map((r): Section => ({
      kind: "funded",
      firstYear: (r.rows.find((x) => !x.accumulation) ?? r.rows[0])?.year ?? 0,
      report: r,
    })),
    ...cashFlowReports.map((r): Section => ({ kind: "cashFlow", firstYear: r.rows[0].year, report: r })),
  ].sort((a, b) => a.firstYear - b.firstYear);

  if (sections.length === 0) {
    return <div className="p-6 text-sm text-ink-3">No goals yet. Add one on the Goals tab.</div>;
  }

  return (
    <div className="space-y-8 p-1">
      {sections.map((s) =>
        s.kind === "funded" ? (
          <section key={s.report.goalId} className="space-y-3">
            <div className="flex items-start justify-between gap-6">
              <h3 className="text-lg font-semibold text-ink">{s.report.name}</h3>
              <div className="flex items-center gap-6 text-sm">
                <div>
                  <span className="text-ink-3">Dedicated Funds Used</span>{" "}
                  <span className="font-semibold text-ink">{formatCurrency(s.report.dedicatedFundsUsed)}</span>
                </div>
                {s.report.cashFlowFundsUsed > 0 && (
                  <div>
                    <span className="text-ink-3">Cash-Flow Funds Used</span>{" "}
                    <span className="font-semibold text-ink">{formatCurrency(s.report.cashFlowFundsUsed)}</span>
                  </div>
                )}
                <div>
                  <span className="text-ink-3">% Funded</span>{" "}
                  <span className={`font-semibold ${s.report.totalShortfall > 0 ? "text-warn" : "text-ink"}`}>
                    {fundedLabel(s.report.totalGoalCost, s.report.totalShortfall)}
                  </span>
                </div>
                <SolverPosGauge
                  state="ready"
                  successPct={successByGoal[s.report.goalId] ?? null}
                  label="Goal Confidence"
                />
              </div>
            </div>
            <div className="h-64">
              <GoalChart chart={s.report.chart} />
            </div>
            <div className="overflow-hidden rounded-md border border-hair-2">
              <AnalysisYearTable
                rows={s.report.rows}
                columns={columns}
                caption={`${s.report.name} — year-by-year`}
                maxHeight={360}
              />
            </div>
          </section>
        ) : (
          <section key={s.report.goalId} className="space-y-3">
            <div className="flex items-start justify-between gap-6">
              <h3 className="text-lg font-semibold text-ink">{s.report.name}</h3>
              <div className="flex items-center gap-6 text-sm">
                <span className="text-ink-3">Paid from cash flow</span>
                <div>
                  <span className="text-ink-3">% Funded</span>{" "}
                  <span className={`font-semibold ${cashFlowShortfall(s.report) > 0 ? "text-warn" : "text-ink"}`}>
                    {fundedLabel(s.report.totalCost, cashFlowShortfall(s.report))}
                  </span>
                </div>
              </div>
            </div>
            <div className="overflow-hidden rounded-md border border-hair-2">
              <AnalysisYearTable
                rows={s.report.rows}
                columns={cashFlowColumns}
                caption={`${s.report.name} — year-by-year`}
                maxHeight={240}
              />
            </div>
          </section>
        ),
      )}
    </div>
  );
}
