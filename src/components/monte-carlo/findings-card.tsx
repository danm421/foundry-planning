import type { MonteCarloSummary } from "@/engine";
import { formatPercent } from "./lib/format";

interface FindingsCardProps {
  summary: MonteCarloSummary;
}

export function FindingsCard({ summary }: FindingsCardProps) {
  const failureRate = summary.failureRate;
  const failCount = Math.round(failureRate * summary.trialsRun);

  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <h3 className="text-sm font-semibold text-slate-100 mb-3">Key Findings & Insights</h3>
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-300">Probability of Failure</div>
        <div className="text-2xl font-semibold text-rose-300 tabular-nums">{formatPercent(failureRate)}</div>
        <div className="text-xs text-slate-400 mt-0.5">
          {failCount.toLocaleString()} of {summary.trialsRun.toLocaleString()} trials ran out of money
        </div>
      </div>
    </section>
  );
}
