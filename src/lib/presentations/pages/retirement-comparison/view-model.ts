import type { BuildDataContext } from "@/components/presentations/registry";
import type { Account, ClientData, ProjectionYear } from "@/engine/types";
import { resolveScenarioRef, keyForRef } from "@/lib/scenario/presentation-refs";
import { buildRetirementComparisonMetrics } from "./metrics";
import { buildTaxBuckets, type TaxBuckets } from "./tax-buckets";
import { fmtUsdCompact } from "./format";
import type {
  RetirementComparisonOptions,
  RetirementComparisonPageData,
  MaxSpendPoint,
  ConfidencePoint,
  KpiCard,
  TaxTreatmentBreakdown,
} from "./types";

function retirementYearOf(clientData: ClientData): number | null {
  const { retirementAge, dateOfBirth } = clientData.client;
  const birthYear = new Date(dateOfBirth).getUTCFullYear();
  if (!Number.isFinite(birthYear) || !Number.isFinite(retirementAge)) return null;
  return birthYear + retirementAge;
}

const EMPTY_BUCKETS: TaxBuckets = { cash: 0, taxable: 0, preTax: 0, roth: 0, hsa: 0 };
const EMPTY_BREAKDOWN: TaxTreatmentBreakdown = { year: 0, base: EMPTY_BUCKETS, scenario: EMPTY_BUCKETS };

const EMPTY = (title: string): RetirementComparisonPageData => ({
  title, subtitle: "", isEmpty: true,
  verdict: { headline: "" },
  kpis: [],
  overlay: [],
  atRetirement: EMPTY_BREAKDOWN,
  atEndOfLife: EMPTY_BREAKDOWN,
  maxSpend: { show: false, baseToday: 0, scenarioToday: 0, series: [] },
  confidence: { show: false, points: [] },
  showPortfolioMatrix: false, showAiSummary: false, aiMarkdown: "",
});

function verdictHeadline(base: number | null, scn: number | null): string {
  if (base == null || scn == null) return "Your plan compared to your current path.";
  const b = Math.round(base * 100);
  const s = Math.round(scn * 100);
  if (s > b) return `${s}% chance your plan fully funds your life — up from ${b}%.`;
  if (s === b) return `Your plan holds a ${s}% chance of fully funding your life.`;
  return `${s}% chance your plan fully funds your life (was ${b}%).`;
}

/** The projection year matching `year`, or the last year if it runs short. */
function yearAt(years: ProjectionYear[], year: number): ProjectionYear {
  return years.find((r) => r.year === year) ?? years[years.length - 1];
}

/** p20 (poor-market) ending balance from the last MC year, or null. */
function endingP20(byYear: { balance: { p20: number } }[] | undefined): number | null {
  if (!byYear || byYear.length === 0) return null;
  return byYear[byYear.length - 1].balance.p20;
}

/** Signed compact-USD delta, e.g. "+$23.6M" / "−$1.2M". */
function signedUsd(delta: number): string {
  return `${delta >= 0 ? "+" : "−"}${fmtUsdCompact(Math.abs(delta))}`;
}

export function buildRetirementComparisonData(
  ctx: BuildDataContext,
  options: RetirementComparisonOptions,
): RetirementComparisonPageData {
  const title = "Retirement Comparison";
  const byRef = ctx.bundlesByRef ?? {};
  const baseBundle = byRef[keyForRef(resolveScenarioRef("base"))];
  const scnBundle = options.scenarioId
    ? byRef[keyForRef(resolveScenarioRef(options.scenarioId))]
    : undefined;

  if (!baseBundle || !scnBundle || scnBundle.projection.years.length === 0) {
    return EMPTY(title);
  }

  const baseYears = baseBundle.projection.years;
  const scenarioYears = scnBundle.projection.years;
  const retirementYear = retirementYearOf(scnBundle.clientData) ?? scenarioYears[0]?.year ?? 0;
  const endOfLifeYear = scenarioYears[scenarioYears.length - 1]?.year ?? retirementYear;
  // Charts never reach back before the plan's current year — i.e. the
  // projection's first year. An already-retired client has a retirementYear in
  // the past, so anything keyed off it must be floored to this.
  const currentYear = scenarioYears[0]?.year ?? retirementYear;

  const baseSuccess = baseBundle.monteCarlo?.summary.successRate ?? null;
  const scnSuccess = scnBundle.monteCarlo?.summary.successRate ?? null;

  const metrics = buildRetirementComparisonMetrics({
    baseYears, scenarioYears, baseSuccess, scenarioSuccess: scnSuccess, retirementYear,
  });

  // ── Max sustainable spending: inflate the solved real (today's $) figure forward. ──
  const planStartYear = scnBundle.clientData.planSettings.planStartYear;
  const inflation = scnBundle.clientData.planSettings.inflationRate ?? 0;
  const baseToday = baseBundle.maxSpend?.realAnnualSpend ?? 0;
  const scnToday = scnBundle.maxSpend?.realAnnualSpend ?? 0;
  const maxSpendShow =
    options.maxSpend.show && baseBundle.maxSpend != null && scnBundle.maxSpend != null;
  const series: MaxSpendPoint[] = [];
  if (maxSpendShow) {
    // Start at retirement, but never before the current year (already-retired
    // clients would otherwise plot deflated pre-plan years).
    for (let y = Math.max(retirementYear, currentYear); y <= endOfLifeYear; y++) {
      const f = Math.pow(1 + inflation, y - planStartYear);
      series.push({ year: y, base: Math.round(baseToday * f), scenario: Math.round(scnToday * f) });
    }
  }

  // ── Confidence band from per-year MC percentiles (no new simulation). ──
  // Only assembled when the band is shown — skip the per-year work otherwise.
  const points: ConfidencePoint[] = [];
  if (options.showConfidenceRange) {
    const baseByYear = new Map((baseBundle.monteCarlo?.summary.byYear ?? []).map((r) => [r.year, r]));
    for (const sRow of scnBundle.monteCarlo?.summary.byYear ?? []) {
      const bRow = baseByYear.get(sRow.year);
      if (!bRow) continue;
      points.push({
        year: sRow.year,
        baseP20: bRow.balance.p20, baseP50: bRow.balance.p50, baseP80: bRow.balance.p80,
        scnP20: sRow.balance.p20, scnP50: sRow.balance.p50, scnP80: sRow.balance.p80,
      });
    }
  }
  const confidenceShow = points.length > 0;

  // ── Portfolio assets by tax treatment (per plan, at each horizon) ──
  const baseAccounts: Account[] = baseBundle.clientData.accounts ?? [];
  const scnAccounts: Account[] = scnBundle.clientData.accounts ?? [];
  const atRetirement: TaxTreatmentBreakdown = {
    year: retirementYear,
    base: buildTaxBuckets(yearAt(baseYears, retirementYear), baseAccounts),
    scenario: buildTaxBuckets(yearAt(scenarioYears, retirementYear), scnAccounts),
  };
  const atEndOfLife: TaxTreatmentBreakdown = {
    year: endOfLifeYear,
    base: buildTaxBuckets(yearAt(baseYears, endOfLifeYear), baseAccounts),
    scenario: buildTaxBuckets(yearAt(scenarioYears, endOfLifeYear), scnAccounts),
  };

  // ── Page-1 headline KPI strip — the metrics that improve ──
  const successPts =
    baseSuccess != null && scnSuccess != null
      ? Math.round(scnSuccess * 100) - Math.round(baseSuccess * 100)
      : null;
  const baseLegacy = metrics.matrix.baseAtEnd.total;
  const scnLegacy = metrics.matrix.scenarioAtEnd.total;
  const baseDownside = endingP20(baseBundle.monteCarlo?.summary.byYear);
  const scnDownside = endingP20(scnBundle.monteCarlo?.summary.byYear);
  const maxSpendAvailable = baseBundle.maxSpend != null && scnBundle.maxSpend != null;

  const kpis: KpiCard[] = [
    {
      label: "Probability of success",
      base: baseSuccess == null ? "—" : `${Math.round(baseSuccess * 100)}%`,
      scenario: scnSuccess == null ? "—" : `${Math.round(scnSuccess * 100)}%`,
      delta: successPts == null ? "" : `${successPts >= 0 ? "+" : "−"}${Math.abs(successPts)} pts`,
      show: successPts != null,
    },
    {
      label: "Legacy to heirs",
      base: fmtUsdCompact(baseLegacy),
      scenario: fmtUsdCompact(scnLegacy),
      delta: signedUsd(scnLegacy - baseLegacy),
      show: true,
    },
    {
      label: "Max sustainable spend",
      base: `${fmtUsdCompact(baseToday)}/yr`,
      scenario: `${fmtUsdCompact(scnToday)}/yr`,
      delta: `${signedUsd(scnToday - baseToday)}/yr`,
      show: maxSpendAvailable,
    },
    {
      label: "Downside ending balance",
      base: baseDownside == null ? "—" : fmtUsdCompact(baseDownside),
      scenario: scnDownside == null ? "—" : fmtUsdCompact(scnDownside),
      delta: baseDownside == null || scnDownside == null ? "" : signedUsd(scnDownside - baseDownside),
      show: baseDownside != null && scnDownside != null,
    },
  ];

  return {
    title,
    subtitle: `Base Case vs. ${scnBundle.scenarioLabel}`,
    isEmpty: false,
    verdict: { headline: verdictHeadline(baseSuccess, scnSuccess) },
    kpis,
    overlay: metrics.overlay,
    atRetirement,
    atEndOfLife,
    maxSpend: { show: maxSpendShow, baseToday, scenarioToday: scnToday, series },
    confidence: { show: confidenceShow, points },
    showPortfolioMatrix: options.showPortfolioMatrix,
    showAiSummary: options.showAiSummary,
    aiMarkdown: options.ai.generatedText,
  };
}
