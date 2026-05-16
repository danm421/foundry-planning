// Pure helpers shared between the screen KPI widget and the PDF KPI renderer.
// No React, no Next.js, no UI-only imports.

import type { ComparisonPlan } from "../build-comparison-plans";
import type { McSharedResult } from "./types";

export type KpiMetricKey =
  | "successProbability"
  | "longevityAge"
  | "endNetWorth"
  | "lifetimeTax"
  | "netToHeirs";

export const KPI_METRIC_LABELS: Record<KpiMetricKey, string> = {
  successProbability: "Success Probability",
  longevityAge: "Longevity Age",
  endNetWorth: "End Net Worth",
  lifetimeTax: "Lifetime Tax",
  netToHeirs: "Net to Heirs",
};

/**
 * Compute the raw numeric value for a KPI metric given a plan + optional MC
 * result. Returns `null` when the value is unavailable.
 *
 * For `successProbability`, `mc` must be non-null and `planIndex` must be
 * provided (defaults to 0).
 */
export function kpiMetricValue(
  metric: string,
  plan: ComparisonPlan | undefined | null,
  mc: McSharedResult | null,
  planIndex = 0,
): number | null {
  switch (metric as KpiMetricKey) {
    case "successProbability":
      return mc?.successByIndex[planIndex] ?? null;
    case "longevityAge":
      return plan?.result.years.at(-1)?.ages.client ?? null;
    case "endNetWorth":
      return plan?.result.years.at(-1)?.portfolioAssets?.total ?? null;
    case "lifetimeTax":
      return plan?.lifetime.total ?? null;
    case "netToHeirs":
      return plan?.finalEstate?.totalToHeirs ?? 0;
    default:
      return null;
  }
}

function formatCurrencyCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function formatAge(n: number): string {
  return String(Math.round(n));
}

/** Format a raw KPI value for display. Returns "—" for null/undefined input. */
export function formatKpi(metric: string, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  switch (metric as KpiMetricKey) {
    case "successProbability":
      return formatPercent(value);
    case "longevityAge":
      return formatAge(value);
    default:
      return formatCurrencyCompact(value);
  }
}
