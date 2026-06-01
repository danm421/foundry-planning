import type { MonteCarloSummary } from "@/engine";
import { formatPercent } from "./lib/format";

interface FindingsCardProps {
  summary: MonteCarloSummary;
}

export function FindingsCard({ summary }: FindingsCardProps) {
  const failureRate = summary.failureRate;
  const failCount = Math.round(failureRate * summary.trialsRun);

  return (
    <section className="rounded-lg bg-card ring-1 ring-hair p-4">
      <h3 className="text-sm font-semibold text-ink mb-3">Key Findings & Insights</h3>
      <div>
        <div className="text-xs uppercase tracking-wider text-ink-2">Probability of Failure</div>
        <div className="text-2xl font-semibold text-crit tabular-nums">{formatPercent(failureRate)}</div>
        <div className="text-xs text-ink-3 mt-0.5">
          {failCount.toLocaleString()} of {summary.trialsRun.toLocaleString()} trials ran out of money
        </div>
      </div>
    </section>
  );
}
