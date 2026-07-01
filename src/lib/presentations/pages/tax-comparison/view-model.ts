import type { BuildDataContext } from "@/components/presentations/registry";
import { resolveScenarioRef, keyForRef } from "@/lib/scenario/presentation-refs";
import { buildTaxBracketRows } from "@/lib/tax/bracket";
import {
  computeLifetimeTotals,
  buildTaxPaidBars,
  computeBracketExposure,
  computeRetirementComposition,
  buildIrmaaRows,
  fmtUsd,
  fmtPct,
} from "@/lib/presentations/pages/tax-summary/aggregate";
import { buildTaxComparisonNarrative } from "./comparison-narrative";
import type { TaxComparisonOptions } from "./options-schema";

export interface TaxComparisonKpi {
  label: string;
  base: string;
  scenario: string;
  delta: string;
  direction: 1 | -1 | 0;
  show: boolean;
}
export interface BracketComparisonRow {
  label: string;
  base: string;
  scenario: string;
  delta: string;
  direction: 1 | -1 | 0;
}
export interface CompositionSide { roth: number; preTax: number; taxable: number; total: number }
export interface CompositionComparison { year: number; base: CompositionSide; scenario: CompositionSide }
export interface TaxComparisonChartYear {
  year: number;
  federalOrdinary: number;
  capGains: number;
  state: number;
  total: number;
  baseTotal: number;
}
export interface TaxComparisonPageData {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  bracketMode: boolean;
  kpis: TaxComparisonKpi[];
  chart: TaxComparisonChartYear[];
  bracket: BracketComparisonRow[] | null;
  composition: CompositionComparison | null;
  narrative: string[];
}

const EMPTY_SIDE: CompositionSide = { roth: 0, preTax: 0, taxable: 0, total: 0 };

const EMPTY = (): TaxComparisonPageData => ({
  title: "Tax Comparison",
  subtitle: "",
  isEmpty: true,
  bracketMode: false,
  kpis: [],
  chart: [],
  bracket: null,
  composition: null,
  narrative: [],
});

/** Lower-is-better: a decrease (delta < 0) is favorable. */
function costDirection(delta: number): 1 | -1 | 0 {
  return delta < 0 ? 1 : delta > 0 ? -1 : 0;
}
function signedUsd(delta: number): string {
  return `${delta >= 0 ? "+" : "−"}${fmtUsd(Math.abs(delta))}`;
}
function signedInt(delta: number): string {
  return `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}`;
}
function kpiUsd(label: string, base: number, scn: number): TaxComparisonKpi {
  const delta = scn - base;
  return { label, base: fmtUsd(base), scenario: fmtUsd(scn), delta: signedUsd(delta), direction: costDirection(delta), show: true };
}
function kpiRate(label: string, base: number, scn: number): TaxComparisonKpi {
  const pts = Math.round(scn * 100) - Math.round(base * 100);
  return {
    label,
    base: fmtPct(base),
    scenario: fmtPct(scn),
    delta: `${pts >= 0 ? "+" : "−"}${Math.abs(pts)} pts`,
    direction: costDirection(pts),
    show: true,
  };
}

export function buildTaxComparisonData(
  ctx: BuildDataContext,
  options: TaxComparisonOptions,
): TaxComparisonPageData {
  const byRef = ctx.bundlesByRef ?? {};
  const baseBundle = byRef[keyForRef(resolveScenarioRef("base"))];
  const scnBundle = options.scenarioId
    ? byRef[keyForRef(resolveScenarioRef(options.scenarioId))]
    : undefined;
  if (!baseBundle || !scnBundle) return EMPTY();

  const baseYears = baseBundle.projection.years;
  const scnYears = scnBundle.projection.years;
  const scnBars = buildTaxPaidBars(scnYears);
  if (scnBars.length === 0) return EMPTY();

  const baseTotals = computeLifetimeTotals(baseYears);
  const scnTotals = computeLifetimeTotals(scnYears);

  // ── KPI strip (five cost metrics, lower-is-better) ──
  const kpis: TaxComparisonKpi[] = [
    kpiUsd("Lifetime Federal Tax", baseTotals.lifetimeFederal, scnTotals.lifetimeFederal),
    kpiUsd("Lifetime State Tax", baseTotals.lifetimeState, scnTotals.lifetimeState),
    kpiUsd("Lifetime Capital Gains Tax", baseTotals.lifetimeCapGains, scnTotals.lifetimeCapGains),
    kpiUsd("Lifetime Total Tax", baseTotals.lifetimeTotal, scnTotals.lifetimeTotal),
    kpiRate("Lifetime Effective Rate", baseTotals.effectiveRate, scnTotals.effectiveRate),
  ];

  // ── Chart: scenario stacks + base total overlay ──
  const baseTotalByYear = new Map(buildTaxPaidBars(baseYears).map((b) => [b.year, b.total]));
  const chart: TaxComparisonChartYear[] = scnBars.map((b) => ({
    year: b.year,
    federalOrdinary: b.federalOrdinary,
    capGains: b.capGains,
    state: b.state,
    total: b.total,
    baseTotal: baseTotalByYear.get(b.year) ?? 0,
  }));

  // ── Bracket exposure comparison ──
  const bracketMode = baseBundle.clientData.planSettings.taxEngineMode === "bracket";
  let bracket: BracketComparisonRow[] | null = null;
  let baseExp: ReturnType<typeof computeBracketExposure> | null = null;
  let scnExp: ReturnType<typeof computeBracketExposure> | null = null;
  if (bracketMode) {
    baseExp = computeBracketExposure(buildTaxBracketRows(baseYears), options.lowThreshold, options.highThreshold);
    scnExp = computeBracketExposure(buildTaxBracketRows(scnYears), options.lowThreshold, options.highThreshold);
    const rangeStr = (e: typeof baseExp) =>
      e != null && e.minRate != null && e.maxRate != null ? `${fmtPct(e.minRate)} – ${fmtPct(e.maxRate)}` : "—";
    bracket = [
      {
        label: `Years below the ${fmtPct(options.lowThreshold)} bracket`,
        base: String(baseExp.yearsBelowLow),
        scenario: String(scnExp.yearsBelowLow),
        delta: signedInt(scnExp.yearsBelowLow - baseExp.yearsBelowLow),
        direction: 0, // more low-bracket years is favorable — keep neutral, narrative interprets
      },
      {
        label: `Years above the ${fmtPct(options.highThreshold)} bracket`,
        base: String(baseExp.yearsAboveHigh),
        scenario: String(scnExp.yearsAboveHigh),
        delta: signedInt(scnExp.yearsAboveHigh - baseExp.yearsAboveHigh),
        direction: costDirection(scnExp.yearsAboveHigh - baseExp.yearsAboveHigh),
      },
      {
        label: "Marginal rate range",
        base: rangeStr(baseExp),
        scenario: rangeStr(scnExp),
        delta: "",
        direction: 0,
      },
    ];
  }

  // ── Composition at retirement ──
  const baseComp = computeRetirementComposition(baseYears, baseBundle.clientData);
  const scnComp = computeRetirementComposition(scnYears, scnBundle.clientData);
  const composition: CompositionComparison | null =
    baseComp || scnComp
      ? {
          year: scnComp?.year ?? baseComp!.year,
          base: baseComp ? { roth: baseComp.roth, preTax: baseComp.preTax, taxable: baseComp.taxable, total: baseComp.total } : EMPTY_SIDE,
          scenario: scnComp ? { roth: scnComp.roth, preTax: scnComp.preTax, taxable: scnComp.taxable, total: scnComp.total } : EMPTY_SIDE,
        }
      : null;

  // ── Narrative ──
  const narrative = buildTaxComparisonNarrative({
    baseLifetimeTotal: baseTotals.lifetimeTotal,
    scnLifetimeTotal: scnTotals.lifetimeTotal,
    baseEffectiveRate: baseTotals.effectiveRate,
    scnEffectiveRate: scnTotals.effectiveRate,
    baseRothAtRet: baseComp?.roth ?? 0,
    scnRothAtRet: scnComp?.roth ?? 0,
    bracketMode,
    baseYearsAboveHigh: baseExp?.yearsAboveHigh ?? 0,
    scnYearsAboveHigh: scnExp?.yearsAboveHigh ?? 0,
    baseYearsBelowLow: baseExp?.yearsBelowLow ?? 0,
    scnYearsBelowLow: scnExp?.yearsBelowLow ?? 0,
    lowThreshold: options.lowThreshold,
    highThreshold: options.highThreshold,
    baseIrmaaYears: buildIrmaaRows(baseYears).length,
    scnIrmaaYears: buildIrmaaRows(scnYears).length,
  });

  const horizon = scnBars.length ? `${scnBars[0].year}–${scnBars[scnBars.length - 1].year}` : "—";
  return {
    title: "Tax Comparison",
    subtitle: `Base Case vs. ${scnBundle.scenarioLabel} · Lifetime ${horizon}`,
    isEmpty: false,
    bracketMode,
    kpis,
    chart,
    bracket,
    composition,
    narrative,
  };
}
