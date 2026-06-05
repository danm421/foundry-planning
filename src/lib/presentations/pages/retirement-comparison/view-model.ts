import type { BuildDataContext } from "@/components/presentations/registry";
import type { ClientData, ProjectionYear } from "@/engine/types";
import { resolveScenarioRef, keyForRef } from "@/lib/scenario/presentation-refs";
import { buildRetirementComparisonMetrics } from "./metrics";
import { lifetimeTaxes } from "@/lib/solver/solver-summary-metrics";
import { deriveRetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import { fmtUsdCompact } from "./format";
import type {
  RetirementComparisonOptions,
  RetirementComparisonPageData,
  MaxSpendPoint,
  ConfidencePoint,
  StatCard,
} from "./types";

function retirementYearOf(clientData: ClientData): number | null {
  const { retirementAge, dateOfBirth } = clientData.client;
  const birthYear = new Date(dateOfBirth).getUTCFullYear();
  if (!Number.isFinite(birthYear) || !Number.isFinite(retirementAge)) return null;
  return birthYear + retirementAge;
}

const HIDDEN_CARD: StatCard = { show: false, base: "", scenario: "", delta: "" };

const EMPTY = (title: string): RetirementComparisonPageData => ({
  title, subtitle: "", isEmpty: true,
  verdict: { headline: "" },
  overlay: [], matrix: null,
  maxSpend: { show: false, baseToday: 0, scenarioToday: 0, series: [] },
  confidence: { show: false, points: [] },
  legacy: HIDDEN_CARD, taxSaved: HIDDEN_CARD, lastsToAge: HIDDEN_CARD,
  showPortfolioMatrix: false, showAiSummary: false, aiMarkdown: "",
});

const TAX_SAVED_THRESHOLD = 2000;

function verdictHeadline(base: number | null, scn: number | null): string {
  if (base == null || scn == null) return "Your plan compared to your current path.";
  const b = Math.round(base * 100);
  const s = Math.round(scn * 100);
  if (s > b) return `${s}% chance your plan fully funds your life — up from ${b}%.`;
  if (s === b) return `Your plan holds a ${s}% chance of fully funding your life.`;
  return `${s}% chance your plan fully funds your life (was ${b}%).`;
}

/** "Money lasts to age" string per plan; "Funded for life" when never short. */
function lastsLabel(years: ProjectionYear[]): { label: string; age: number | null } {
  const summary = deriveRetirementSummary(years);
  if (summary.fullyFunded || summary.ageAssetsLastUntil == null) {
    return { label: "Funded for life", age: null };
  }
  return { label: `age ${summary.ageAssetsLastUntil.client}`, age: summary.ageAssetsLastUntil.client };
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
    for (let y = retirementYear; y <= endOfLifeYear; y++) {
      const f = Math.pow(1 + inflation, y - planStartYear);
      series.push({ year: y, base: Math.round(baseToday * f), scenario: Math.round(scnToday * f) });
    }
  }

  // ── Confidence band from per-year MC percentiles (no new simulation). ──
  const baseByYear = new Map((baseBundle.monteCarlo?.summary.byYear ?? []).map((r) => [r.year, r]));
  const scnByYear = new Map((scnBundle.monteCarlo?.summary.byYear ?? []).map((r) => [r.year, r]));
  const points: ConfidencePoint[] = [];
  for (const [year, sRow] of scnByYear) {
    const bRow = baseByYear.get(year);
    if (!bRow) continue;
    points.push({
      year,
      baseP20: bRow.balance.p20, baseP50: bRow.balance.p50, baseP80: bRow.balance.p80,
      scnP20: sRow.balance.p20, scnP50: sRow.balance.p50, scnP80: sRow.balance.p80,
    });
  }
  const confidenceShow = options.showConfidenceRange && points.length > 0;

  // ── Stat cards ──
  const legacyDelta = metrics.matrix.scenarioAtEnd.total - metrics.matrix.baseAtEnd.total;
  const legacy: StatCard = {
    show: true,
    base: fmtUsdCompact(metrics.matrix.baseAtEnd.total),
    scenario: fmtUsdCompact(metrics.matrix.scenarioAtEnd.total),
    delta: `${legacyDelta >= 0 ? "+" : "−"}${fmtUsdCompact(Math.abs(legacyDelta))}`,
  };

  const baseTax = lifetimeTaxes(baseYears);
  const scnTax = lifetimeTaxes(scenarioYears);
  const taxSaving = baseTax - scnTax;
  const taxSaved: StatCard = taxSaving > TAX_SAVED_THRESHOLD
    ? { show: true, base: fmtUsdCompact(baseTax), scenario: fmtUsdCompact(scnTax), delta: `−${fmtUsdCompact(taxSaving)}` }
    : HIDDEN_CARD;

  const baseLasts = lastsLabel(baseYears);
  const scnLasts = lastsLabel(scenarioYears);
  const scnLastsLonger =
    (scnLasts.age == null && baseLasts.age != null) ||
    (scnLasts.age != null && baseLasts.age != null && scnLasts.age > baseLasts.age);
  const lastsToAge: StatCard = scnLastsLonger
    ? { show: true, base: baseLasts.label, scenario: scnLasts.label, delta: "" }
    : HIDDEN_CARD;

  return {
    title,
    subtitle: `Base Case vs. ${scnBundle.scenarioLabel}`,
    isEmpty: false,
    verdict: { headline: verdictHeadline(baseSuccess, scnSuccess) },
    overlay: metrics.overlay,
    matrix: metrics.matrix,
    maxSpend: { show: maxSpendShow, baseToday, scenarioToday: scnToday, series },
    confidence: { show: confidenceShow, points },
    legacy, taxSaved, lastsToAge,
    showPortfolioMatrix: options.showPortfolioMatrix,
    showAiSummary: options.showAiSummary,
    aiMarkdown: options.ai.generatedText,
  };
}
