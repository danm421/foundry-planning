export type KpiMetric =
  | "successProbability"
  | "longevityAge"
  | "endNetWorth"
  | "lifetimeTax"
  | "netToHeirs";

const METRIC_LABELS: Record<KpiMetric, string> = {
  successProbability: "Success Probability",
  longevityAge: "Longevity Age",
  endNetWorth: "End Net Worth",
  lifetimeTax: "Lifetime Tax",
  netToHeirs: "Net to Heirs",
};

function formatCurrencyCompact(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPercent(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return `${Math.round(n * 100)}%`;
}

function formatAge(n: number | undefined): string {
  if (n === undefined || !Number.isFinite(n)) return "—";
  return String(Math.round(n));
}

interface KpiComparisonSectionProps {
  metric: KpiMetric;
  /** Pre-computed value for the metric; `undefined` renders as "—". For
   *  currency metrics, pass a number. For success probability, pass 0..1.
   *  For longevity age, pass the final year's age. */
  value: number | undefined;
}

export function KpiComparisonSection({ metric, value }: KpiComparisonSectionProps) {
  let display: string;
  if (metric === "successProbability") display = formatPercent(value);
  else if (metric === "longevityAge") display = formatAge(value);
  else display = formatCurrencyCompact(value);

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-3xl font-semibold tabular-nums">{display}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-neutral-500">
        {METRIC_LABELS[metric]}
      </div>
    </div>
  );
}
