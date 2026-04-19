import type { MonteCarloSummary } from "@/engine";
import { formatShortCurrency, formatPercent } from "./lib/format";

interface FindingsCardProps {
  summary: MonteCarloSummary;
  deterministicEnding: number | undefined;
}

export function FindingsCard({ summary, deterministicEnding }: FindingsCardProps) {
  const failureRate = summary.failureRate;
  const failCount = Math.round(failureRate * summary.trialsRun);
  const median = summary.ending.p50;
  const delta = deterministicEnding != null ? median - deterministicEnding : null;

  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <h3 className="text-sm font-semibold text-slate-100 mb-3">Key Findings & Insights</h3>
      <div className="flex flex-col gap-4">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Probability of Failure</div>
          <div className="text-2xl font-semibold text-rose-300 tabular-nums">{formatPercent(failureRate)}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            {failCount.toLocaleString()} of {summary.trialsRun.toLocaleString()} trials ran out of money
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-400">Est. Median Value</div>
          <div className="text-2xl font-semibold text-slate-100 tabular-nums">{formatShortCurrency(median)}</div>
          {delta != null ? (
            <div
              className={
                delta >= 0
                  ? "text-[11px] text-emerald-300 tabular-nums mt-0.5"
                  : "text-[11px] text-rose-300 tabular-nums mt-0.5"
              }
            >
              {delta >= 0 ? "+" : ""}{formatShortCurrency(delta)} vs cash-flow projection
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
