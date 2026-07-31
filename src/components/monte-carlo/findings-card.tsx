import type { MonteCarloSummary } from "@/engine";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { formatPercent } from "./lib/format";
import { SHORTFALL_RISK_LABEL, SHORTFALL_RISK_TOOLTIP, shortfallFootnote } from "./lib/copy";

interface FindingsCardProps {
  summary: MonteCarloSummary;
}

export function FindingsCard({ summary }: FindingsCardProps) {
  const failureRate = summary.failureRate;
  const failCount = Math.round(failureRate * summary.trialsRun);

  return (
    <section className="rounded-lg bg-card ring-1 ring-hair p-4">
      <h3 className="text-sm font-semibold text-ink mb-3">Key Findings &amp; Insights</h3>
      <div>
        <div className="flex items-center gap-1 text-xs uppercase tracking-wider text-ink-2">
          {SHORTFALL_RISK_LABEL}
          <FieldTooltip text={SHORTFALL_RISK_TOOLTIP} />
        </div>
        <div className="text-2xl font-semibold text-crit tabular-nums">{formatPercent(failureRate)}</div>
        <div className="text-xs text-ink-3 mt-0.5">
          {shortfallFootnote(failCount, summary.trialsRun)}
        </div>
      </div>
    </section>
  );
}
