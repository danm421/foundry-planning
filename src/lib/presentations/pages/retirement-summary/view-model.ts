// src/lib/presentations/pages/retirement-summary/view-model.ts
import type { BuildDataContext } from "@/components/presentations/registry";
import type { RetirementSummaryOptions } from "./options-schema";
import {
  retirementYearOf, liquidThreePoints, portfolioBars, assetsByType, assetsByTaxType,
  livingExpensesTodayVsRetirement, otherRetirementExpenses, incomeInRetirement,
  assetTransactionsInRetirement, fmtPct,
  type PortfolioBar, type AssetsByType, type AssetsByTaxType, type LiquidThreePoints,
  type LivingExpenseCompare, type OtherRetirementExpenses, type RetirementIncomeRow, type AssetTxnRow,
} from "./aggregate";
import { buildSocialSecurity, type SsBreakdown } from "./social-security";
import { lifetimeFunding, type FundingBreakdown } from "@/lib/analysis/retirement-funding";
import { buildRetirementNarrative } from "./narrative";

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
  socialSecurity: SsBreakdown;
  living: LivingExpenseCompare;
  otherExpenses: OtherRetirementExpenses;
  income: RetirementIncomeRow[];
  transactions: AssetTxnRow[];
  narrative: string[];
}

// Funding-source labels for the dominant-source narrative signal.
const FUNDING_LABELS: Array<{ key: keyof FundingBreakdown; label: string }> = [
  { key: "socialSecurity", label: "Social Security" },
  { key: "otherIncome", label: "Ongoing income" },
  { key: "rmds", label: "RMDs" },
  { key: "withdrawalsCash", label: "Cash withdrawals" },
  { key: "withdrawalsTaxable", label: "Taxable withdrawals" },
  { key: "withdrawalsPreTax", label: "Pre-tax withdrawals" },
  { key: "withdrawalsRoth", label: "Roth withdrawals" },
];

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
  const socialSecurity = buildSocialSecurity(clientData, nowYear, {
    client: ctx.clientName,
    spouse: ctx.spouseName ?? "Spouse",
  });
  const living = livingExpensesTodayVsRetirement(years, clientData, retYear);
  const otherExpenses = otherRetirementExpenses(years, retYear);
  const income = incomeInRetirement(years, clientData, retYear);
  const transactions = assetTransactionsInRetirement(years, retYear);

  const mcRate = ctx.monteCarlo?.summary.successRate ?? null;

  // Narrative inputs.
  const dominant = FUNDING_LABELS
    .map((f) => ({ label: f.label, value: funding[f.key] as number }))
    .reduce<{ label: string; value: number } | null>((best, c) => (best == null || c.value > best.value ? c : best), null);
  const dominantSource =
    dominant && funding.totalSpending > 0
      ? { label: dominant.label, share: dominant.value / funding.totalSpending }
      : null;

  // SS delay value: for a not-yet-claiming client, compare their selected age's
  // benefit to the age-70 benefit.
  const ssDelayGain = (() => {
    const c = socialSecurity.client;
    if (!c || c.alreadyClaiming || c.ladder.length < 2) return null;
    const sel = c.ladder.find((r) => r.selected);
    const at70 = c.ladder.find((r) => r.age === 70);
    if (!sel || !at70 || sel.age >= 70 || sel.monthly <= 0) return null;
    return { name: c.name, fromAge: sel.age, toAge: 70, pctGain: at70.monthly / sel.monthly - 1 };
  })();

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
    liquid, bars, byType, byTaxType, funding, socialSecurity,
    living, otherExpenses, income, transactions, narrative,
  };
}
