import type { BuildDataContext } from "@/components/presentations/registry";
import { buildTaxBracketRows } from "@/lib/tax/bracket";
import type { TaxSummaryOptions } from "./options-schema";
import {
  computeLifetimeTotals,
  computeBracketExposure,
  buildTaxPaidBars,
  computeRetirementComposition,
  buildRothConversionRows,
  buildIrmaaRows,
  buildCapGainsEvents,
  type TaxYearBar,
  type BracketExposure,
  type RetirementComposition,
  type CapGainsEventRow,
} from "./aggregate";
import { buildTaxNarrative } from "./narrative";

export interface TaxSummaryKpis {
  lifetimeFederal: number;
  lifetimeState: number;
  lifetimeCapGains: number;
  lifetimeTotal: number;
  effectiveRate: number;
}

export interface TaxSummaryPageData {
  title: string;
  subtitle: string;
  isEmpty: boolean;
  bracketMode: boolean;
  kpis: TaxSummaryKpis;
  chart: TaxYearBar[];
  bracket: BracketExposure | null;
  composition: RetirementComposition | null;
  narrative: string[];
}

export function buildTaxSummaryData(
  ctx: BuildDataContext,
  options: TaxSummaryOptions,
): TaxSummaryPageData {
  const { years, clientData } = ctx;
  const bracketMode = clientData.planSettings.taxEngineMode === "bracket";

  const totals = computeLifetimeTotals(years);
  const bars = buildTaxPaidBars(years);
  const isEmpty = bars.length === 0;

  const bracketRows = buildTaxBracketRows(years);
  const bracket = bracketMode
    ? computeBracketExposure(bracketRows, options.lowThreshold, options.highThreshold)
    : null;

  const composition = computeRetirementComposition(years, clientData);

  // Opportunity rows feed the page-1 takeaways narrative below; they are no
  // longer rendered as a standalone table page.
  const rothConversions = buildRothConversionRows(bracketRows);
  const irmaa = buildIrmaaRows(years);
  const capGainsEvents = buildCapGainsEvents(years);

  const rothTotal = rothConversions.reduce((s, r) => s + r.gross, 0);
  const irmaaTotal = irmaa.reduce((s, r) => s + r.surcharge, 0);
  // rothConversions is year-ordered (it's filtered from buildTaxBracketRows,
  // which iterates years ascending), so first/last entries bound the span.
  const rothFirstYear = rothConversions.length ? rothConversions[0].year : null;
  const rothLastYear = rothConversions.length ? rothConversions[rothConversions.length - 1].year : null;
  const largestGain = capGainsEvents.reduce<CapGainsEventRow | null>(
    (best, e) => (best == null || e.gain > best.gain ? e : best),
    null,
  );

  const narrative = buildTaxNarrative({
    lifetimeTotal: totals.lifetimeTotal,
    effectiveRate: totals.effectiveRate,
    bracketMode,
    yearsBelowLow: bracket?.yearsBelowLow ?? 0,
    yearsAboveHigh: bracket?.yearsAboveHigh ?? 0,
    lowThreshold: options.lowThreshold,
    highThreshold: options.highThreshold,
    rothConversionTotal: rothTotal,
    rothConversionYears: rothConversions.length,
    rothFirstYear,
    rothLastYear,
    irmaaYears: irmaa.length,
    irmaaTotal,
    largestGain,
  });

  const horizon = bars.length ? `${bars[0].year}–${bars[bars.length - 1].year}` : "—";

  return {
    title: "Tax Summary",
    subtitle: `${ctx.scenarioLabel} · Lifetime ${horizon}`,
    isEmpty,
    bracketMode,
    kpis: {
      lifetimeFederal: totals.lifetimeFederal,
      lifetimeState: totals.lifetimeState,
      lifetimeCapGains: totals.lifetimeCapGains,
      lifetimeTotal: totals.lifetimeTotal,
      effectiveRate: totals.effectiveRate,
    },
    chart: bars,
    bracket,
    composition,
    narrative,
  };
}
