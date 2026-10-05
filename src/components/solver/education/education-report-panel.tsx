"use client";

import { useMemo } from "react";
import type { ProjectionYear } from "@/engine/types";
import { buildGoalReport } from "@/lib/reports/goal-report-data";
import {
  buildGoalMcInput,
  type GoalReturnStat,
} from "@/lib/reports/goal-mc-inputs";
import { runGoalMc } from "@/engine/goals/goal-mc";
import { GoalChart } from "@/components/charts/goal-chart";
import { AnalysisYearTable } from "@/components/scenario/year-table";
import { goalYearColumns } from "@/components/scenario/goal-year-columns";
import { formatCurrency } from "@/components/monte-carlo/lib/format";
import { SolverPosGauge } from "@/app/(app)/clients/[id]/solver/solver-pos-gauge";

// Neutral blended-return fallback for a goal with no server-supplied stats
// (e.g. a goal added live in the solver, or a zero-balance dedicated pool).
// A moderate-growth, moderate-volatility index — keeps the gauge directional.
const FALLBACK_RETURN_STAT: GoalReturnStat = { arithMean: 0.06, stdDev: 0.12 };
// Stable default seed so the gauge is deterministic when the solver hasn't
// supplied the scenario's own Monte Carlo seed (never Math.random/Date).
const DEFAULT_EDUCATION_SEED = 1;

/** Share of the goal's indexed cost that got funded — from any source. Derived
 *  from the shortfall rather than from the withdrawals so a fully funded goal
 *  reads exactly 100% (the two sums are floats). Rounds DOWN whenever anything
 *  is unfunded, so the headline never says 100% next to a live shortfall. */
function fundedLabel(totalGoalCost: number, totalShortfall: number): string {
  if (totalGoalCost <= 0) return "—";
  const pct = (1 - totalShortfall / totalGoalCost) * 100;
  return `${totalShortfall > 0 ? Math.floor(pct) : Math.round(pct)}%`;
}

interface Props {
  years: ProjectionYear[];
  expenses: { id: string; name: string; payShortfallOutOfPocket?: boolean }[];
  /** Blended dedicated-pool return stats per goalId, from the solver's plan MC
   *  data. Optional — goals without an entry use FALLBACK_RETURN_STAT. */
  returnStats?: Record<string, GoalReturnStat>;
  /** Scenario Monte Carlo seed, for reproducible per-goal gauges. */
  seed?: number;
}

export function EducationReportPanel({ years, expenses, returnStats, seed }: Props) {
  const reports = useMemo(() => buildGoalReport(years, expenses), [years, expenses]);
  const columns = useMemo(() => goalYearColumns(), []);

  // Per-goal probability of success: simulate the dedicated pool's stochastic
  // balance path against the deterministic withdrawal schedule. Cheap (a single
  // blended index, no runProjection), so it runs client-side here.
  const mcSeed = seed ?? DEFAULT_EDUCATION_SEED;
  const successByGoal = useMemo(() => {
    const stats = returnStats ?? {};
    const out: Record<string, number> = {};
    for (const r of reports) {
      const goalStats = stats[r.goalId] ?? FALLBACK_RETURN_STAT;
      out[r.goalId] = runGoalMc(buildGoalMcInput(r, goalStats, mcSeed)).successRate;
    }
    return out;
  }, [reports, returnStats, mcSeed]);

  if (reports.length === 0) {
    return (
      <div className="p-6 text-sm text-ink-3">
        No education goals. Add an Education expense with dedicated funding on
        the Income &amp; Expenses page.
      </div>
    );
  }

  return (
    <div className="space-y-8 p-1">
      {reports.map((r) => (
        <section key={r.goalId} className="space-y-3">
          <div className="flex items-start justify-between gap-6">
            <h3 className="text-lg font-semibold text-ink">{r.name}</h3>
            <div className="flex items-center gap-6 text-sm">
              <div>
                <span className="text-ink-3">Dedicated Funds Used</span>{" "}
                <span className="font-semibold text-ink">{formatCurrency(r.dedicatedFundsUsed)}</span>
              </div>
              {r.cashFlowFundsUsed > 0 && (
                <div>
                  <span className="text-ink-3">Cash-Flow Funds Used</span>{" "}
                  <span className="font-semibold text-ink">{formatCurrency(r.cashFlowFundsUsed)}</span>
                </div>
              )}
              <div>
                <span className="text-ink-3">% Funded</span>{" "}
                <span className={`font-semibold ${r.totalShortfall > 0 ? "text-warn" : "text-ink"}`}>
                  {fundedLabel(r.totalGoalCost, r.totalShortfall)}
                </span>
              </div>
              <SolverPosGauge
                state="ready"
                successPct={successByGoal[r.goalId] ?? null}
                label="Goal Confidence"
              />
            </div>
          </div>
          <div className="h-64">
            <GoalChart chart={r.chart} />
          </div>
          <div className="overflow-hidden rounded-md border border-hair-2">
            <AnalysisYearTable rows={r.rows} columns={columns} caption={`${r.name} — year-by-year`} maxHeight={360} />
          </div>
        </section>
      ))}
    </div>
  );
}
