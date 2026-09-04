import { FieldTooltip } from "@/components/forms/field-tooltip";
import { fmtPct, fmtUsd } from "@/lib/tax-analysis/format";
import type { Reconciliation } from "@/lib/tax-reconciliation/types";

const usd = (v: number | null) => (v == null ? "—" : fmtUsd(v));
const pct = (v: number | null) => (v == null ? "—" : fmtPct(v));

function Tile({
  label,
  ret,
  plan,
  caption,
}: {
  label: string;
  ret: string;
  plan: string;
  caption?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-hair bg-card p-3">
      <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{label}</span>
      <span className="tabular text-lg font-semibold text-ink">{ret}</span>
      <span className="tabular text-xs text-ink-2">Plan {plan}</span>
      {caption && <span className="tabular text-xs text-ink-3">{caption}</span>}
    </div>
  );
}

export function OverviewStrip({
  overview: o,
  taxYear,
  planYear,
}: {
  overview: Reconciliation["overview"];
  taxYear: number;
  planYear: number;
}) {
  // R69: every plan figure on this page is stated in TAX-YEAR dollars, so the
  // units are named once here rather than stamped over each figure as a year
  // the number is not in.
  const units =
    planYear === taxYear
      ? `The plan year and the return year are the same, so both columns are already in ${taxYear} dollars.`
      : `The plan's ${planYear} figures are restated in ${taxYear} dollars — each row by its own growth rate, engine totals by the plan's inflation rate — so the two columns compare directly.`;

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-3">
        <span className="tabular">
          Return {taxYear} · Plan {planYear}
        </span>
        <FieldTooltip text={units} />
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Total income" ret={usd(o.totalIncome.return)} plan={usd(o.totalIncome.plan)} />
        <Tile
          label="Federal tax"
          ret={usd(o.federalTax.return)}
          plan={usd(o.federalTax.plan)}
          caption={`Effective ${pct(o.effectiveRate.return)} · ${pct(o.effectiveRate.plan)}`}
        />
        <Tile label="AGI" ret={usd(o.agi.return)} plan={usd(o.agi.plan)} />
        <div className="flex flex-col gap-0.5 rounded-lg border border-hair bg-card p-3">
          <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
            Open suggestions
          </span>
          <span className="tabular text-lg font-semibold text-ink">{o.openCount}</span>
          <span className="tabular text-xs text-ink-3">
            {o.inLineCount} in line · {o.dismissedCount} not applicable
          </span>
        </div>
      </div>
    </div>
  );
}
