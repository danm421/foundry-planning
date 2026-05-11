import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

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
  plan: ComparisonPlan | undefined;
  metric: KpiMetric;
  successProbability?: number;
}

export function KpiComparisonSection({
  plan,
  metric,
  successProbability,
}: KpiComparisonSectionProps) {
  let value: string;

  if (!plan && metric !== "successProbability") {
    value = "—";
  } else if (metric === "successProbability") {
    value = formatPercent(successProbability);
  } else if (metric === "longevityAge") {
    const lastYear = plan?.result.years.at(-1);
    value = formatAge(lastYear?.ages.client);
  } else if (metric === "endNetWorth") {
    const lastYear = plan?.result.years.at(-1) as { totalNetWorth?: number } | undefined;
    value = formatCurrencyCompact(lastYear?.totalNetWorth);
  } else if (metric === "lifetimeTax") {
    const result = plan?.result as { summary?: { lifetimeTax?: number } } | undefined;
    value = formatCurrencyCompact(result?.summary?.lifetimeTax);
  } else if (metric === "netToHeirs") {
    const result = plan?.result as { summary?: { netToHeirs?: number } } | undefined;
    value = formatCurrencyCompact(result?.summary?.netToHeirs);
  } else {
    value = "—";
  }

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900">
      <div className="text-3xl font-semibold tabular-nums">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-neutral-500">
        {METRIC_LABELS[metric]}
      </div>
    </div>
  );
}
