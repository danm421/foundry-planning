// Pure, framework-free helpers that build display data from RetirementSummary.
// No JSX — only TypeScript. Safe to import in unit tests without a DOM.

import type { RetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import type { HeadlineSegment } from "@/components/analysis/analysis-headline";
import type { KpiItem } from "@/components/analysis/analysis-kpi-row";
import { formatCurrency } from "@/components/monte-carlo/lib/format";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function fmtAge(ageInfo: RetirementSummary["ageAssetsLastUntil"]): string {
  if (ageInfo === null) return "—";
  if (ageInfo.spouse === null) return String(ageInfo.client);
  return `${ageInfo.client}/${ageInfo.spouse}`;
}

function fmtPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

// ---------------------------------------------------------------------------
// Headline builders
// ---------------------------------------------------------------------------

/**
 * Builds the deterministic retirement summary headline.
 *
 * Fully funded:
 *   "You are projected to fund your retirement " + "for the rest of their lives."
 *
 * Runs short:
 *   "You are projected to be able to fund your retirement until age " + "85/81."
 *   (ages segment is accent)
 */
export function buildSummaryHeadline(
  summary: RetirementSummary,
): HeadlineSegment[] {
  if (summary.fullyFunded) {
    return [
      { text: "You are projected to fund your retirement " },
      { text: "for the rest of their lives.", accent: true },
    ];
  }

  const ageLabel = fmtAge(summary.ageAssetsLastUntil);
  return [
    { text: "You are projected to be able to fund your retirement until age " },
    { text: `${ageLabel}.`, accent: true },
  ];
}

/**
 * Builds the Monte Carlo probability headline.
 *
 * "You are projected to fund your retirement " + "27%" + " of the time."
 * The percent segment is accent.
 */
export function buildProbabilityHeadline(
  successRate: number,
): HeadlineSegment[] {
  return [
    { text: "You are projected to fund your retirement " },
    { text: fmtPercent(successRate), accent: true },
    { text: " of the time." },
  ];
}

// ---------------------------------------------------------------------------
// KPI builder
// ---------------------------------------------------------------------------

// eMoney explainer copy — kept verbatim to match the reference UI.
const EXPLAINERS = {
  assetsRemaining:
    "The cumulative dollar value of all accounts remaining at the end of the analysis.",
  ageAssetsLastUntil:
    "The age until which assets are available for withdrawals.",
  yearsFullyFunded:
    "The number of years in this analysis in which annual expenses are fully covered by a combination of incomes and withdrawals.",
  avgPercentFunded:
    "The average of how much of your expenses will likely be covered in years in which not all expenses are covered.",
} as const;

/**
 * Builds the 4 KPI items matching eMoney labels and explainers exactly.
 */
export function buildKpis(summary: RetirementSummary): KpiItem[] {
  const assetsValue = formatCurrency(summary.assetsRemaining);

  const ageValue = summary.ageAssetsLastUntil === null
    ? "—"
    : fmtAge(summary.ageAssetsLastUntil);

  const yearsValue = String(summary.yearsFullyFunded);

  const avgPctValue =
    summary.avgPercentFunded === null
      ? "—"
      : fmtPercent(summary.avgPercentFunded);

  return [
    {
      value: assetsValue,
      label: "Assets Remaining",
      explainer: EXPLAINERS.assetsRemaining,
      tone: summary.assetsRemaining < 0 ? "crit" : "default",
    },
    {
      value: ageValue,
      label: "Age Assets Last Until",
      explainer: EXPLAINERS.ageAssetsLastUntil,
    },
    {
      value: yearsValue,
      label: "Years Fully Funded",
      explainer: EXPLAINERS.yearsFullyFunded,
    },
    {
      value: avgPctValue,
      label: "Average Percent Funded in Partially Funded Years",
      explainer: EXPLAINERS.avgPercentFunded,
    },
  ];
}
