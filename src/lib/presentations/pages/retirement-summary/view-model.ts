// src/lib/presentations/pages/retirement-summary/view-model.ts
import type { BuildDataContext } from "@/components/presentations/registry";
import type { RetirementSummaryOptions } from "./options-schema";
import type { ChartSpec } from "@/lib/presentations/charts/types";
import { buildCashFlowPageData } from "../cash-flow/view-model";
import {
  retirementYearOf, liquidThreePoints, portfolioBars, assetsByType, assetsByTaxType,
  livingExpensesTodayVsRetirement, otherRetirementExpenses, incomeInRetirement,
  assetTransactionsInRetirement, fmtPct,
  type PortfolioBar, type AssetsByType, type AssetsByTaxType, type LiquidThreePoints,
  type LivingExpenseCompare, type OtherRetirementExpenses, type RetirementIncomeRow, type AssetTxnRow,
} from "./aggregate";
import { buildSocialSecurity, type SsBreakdown, type SsClient } from "./social-security";
import { lifetimeFunding, type FundingBreakdown } from "@/lib/analysis/retirement-funding";
import { buildRetirementNarrative } from "./narrative";

/** Lifetime funding sources in display order — the single source of truth for
 *  both the dominant-source narrative signal and the page's funding bar. */
export interface FundingSource { label: string; value: number; }

const FUNDING_KEYS: Array<{ key: keyof FundingBreakdown; label: string }> = [
  { key: "socialSecurity", label: "Social Security" },
  { key: "otherIncome", label: "Ongoing income" },
  { key: "rmds", label: "RMDs" },
  { key: "withdrawalsCash", label: "Cash withdrawals" },
  { key: "withdrawalsTaxable", label: "Taxable withdrawals" },
  { key: "withdrawalsPreTax", label: "Pre-tax withdrawals" },
  { key: "withdrawalsRoth", label: "Roth withdrawals" },
];

/** SS delay value: for a not-yet-claiming client, the lift from claiming at the
 *  selected age vs. age 70. Null when there's nothing meaningful to compare. */
function computeSsDelayGain(c: SsClient | null) {
  if (!c || c.alreadyClaiming || c.ladder.length < 2) return null;
  const sel = c.ladder.find((r) => r.selected);
  const at70 = c.ladder.find((r) => r.age === 70);
  if (!sel || !at70 || sel.age >= 70 || sel.monthly <= 0) return null;
  return { name: c.name, fromAge: sel.age, toAge: 70, pctGain: at70.monthly / sel.monthly - 1 };
}

export interface RetirementSummaryKpis {
  monteCarlo: string;      // "92%" or "—"
  liquidNow: number;
  liquidRetirement: number;
  liquidEndOfLife: number;
  retirementAge: number;
  retirementYear: number;
  totalSpend: number;
}

export interface RetirementSummaryPageData {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  isMarried: boolean;
  kpis: RetirementSummaryKpis;
  liquid: LiquidThreePoints;
  bars: PortfolioBar[];
  byType: AssetsByType;
  byTaxType: AssetsByTaxType;
  funding: FundingBreakdown;
  fundingSources: FundingSource[];
  socialSecurity: SsBreakdown;
  living: LivingExpenseCompare;
  otherExpenses: OtherRetirementExpenses;
  income: RetirementIncomeRow[];
  transactions: AssetTxnRow[];
  narrative: string[];
  cashFlowChartSpec: ChartSpec;
}

export function buildRetirementSummaryData(
  ctx: BuildDataContext,
  _options: RetirementSummaryOptions,
): RetirementSummaryPageData {
  const { years, clientData } = ctx;
  const retYear = retirementYearOf(clientData) ?? years[0]?.year ?? 0;
  const nowYear = years[0]?.year ?? retYear;
  const isEmpty = years.length === 0;
  const isMarried = ctx.spouseName != null || clientData.client.spouseDob != null;

  const liquid = liquidThreePoints(years, retYear);
  const bars = portfolioBars(years);
  const byType = assetsByType(years, retYear);
  const byTaxType = assetsByTaxType(years, clientData, retYear);
  const funding = lifetimeFunding(years, clientData.accounts, retYear);
  const fundingSources: FundingSource[] = FUNDING_KEYS.map((f) => ({ label: f.label, value: funding[f.key] as number }));
  const socialSecurity = buildSocialSecurity(clientData, nowYear, ctx.clientName, ctx.spouseName ?? "Spouse");
  const living = livingExpensesTodayVsRetirement(years, clientData, retYear);
  const otherExpenses = otherRetirementExpenses(years, retYear);
  const income = incomeInRetirement(years, clientData, retYear);
  const transactions = assetTransactionsInRetirement(years, retYear);

  // Cash-flow chart for page 2: reuse the standalone Cash Flow page builder
  // (range "retirement" slices to the first retirement year + carries the RMD
  // double-count logic) and take just its chart spec, fitted to the portrait
  // page-2 panel.
  const cf = buildCashFlowPageData({
    years,
    clientData,
    options: { range: "retirement", showCallout: false },
    scenarioLabel: ctx.scenarioLabel,
    clientName: ctx.clientName,
    spouseName: ctx.spouseName ?? null,
  });
  const cashFlowChartSpec: ChartSpec = {
    ...cf.chartSpec,
    width: 500,
    height: 210,
    // The chart is sliced to [retirement..end-of-life], so both timeline markers land
    // on the domain edges: the retirement line duplicates the leftmost bar and the
    // end-of-life label clips past the right edge. Drop both for the compact page-2 panel.
    markers: cf.chartSpec.markers.filter(
      (m) => m.iconKind !== "retirement" && m.iconKind !== "endOfLife",
    ),
  };

  const mcRate = ctx.monteCarlo?.summary.successRate ?? null;

  // Narrative inputs.
  const dominant = fundingSources.reduce<FundingSource | null>(
    (best, c) => (best == null || c.value > best.value ? c : best), null);
  const dominantSource =
    dominant && funding.totalSpending > 0
      ? { label: dominant.label, share: dominant.value / funding.totalSpending }
      : null;

  const ssDelayGain = computeSsDelayGain(socialSecurity.client);

  const rothShare = byTaxType.total > 0 ? byTaxType.roth / byTaxType.total : 0;

  const narrative = buildRetirementNarrative({
    monteCarloSuccess: mcRate,
    liquidEndOfLife: liquid.endOfLife,
    dominantSource,
    shortfall: funding.shortfall,
    ssDelayGain,
    rothShare,
  });

  return {
    title: "Retirement Summary",
    subtitle: isEmpty
      ? ctx.scenarioLabel
      : `${ctx.scenarioLabel} · Retire age ${clientData.client.retirementAge} in ${retYear} · through ${years[years.length - 1].year}`,
    isEmpty,
    isMarried,
    kpis: {
      monteCarlo: mcRate != null ? fmtPct(mcRate) : "—",
      liquidNow: liquid.now,
      liquidRetirement: liquid.retirement,
      liquidEndOfLife: liquid.endOfLife,
      retirementAge: clientData.client.retirementAge,
      retirementYear: retYear,
      totalSpend: funding.totalSpending,
    },
    liquid, bars, byType, byTaxType, funding, fundingSources, socialSecurity,
    living, otherExpenses, income, transactions, narrative, cashFlowChartSpec,
  };
}
