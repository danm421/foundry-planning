import { fmtUsd, fmtPct } from "@/lib/presentations/pages/tax-summary/aggregate";

export interface TaxComparisonNarrativeInput {
  baseLifetimeTotal: number;
  scnLifetimeTotal: number;
  baseEffectiveRate: number;
  scnEffectiveRate: number;
  baseRothAtRet: number;
  scnRothAtRet: number;
  bracketMode: boolean;
  baseYearsAboveHigh: number;
  scnYearsAboveHigh: number;
  baseYearsBelowLow: number;
  scnYearsBelowLow: number;
  lowThreshold: number;
  highThreshold: number;
  baseIrmaaYears: number;
  scnIrmaaYears: number;
}

const MAX_LINES = 4;
const ROTH_SHIFT_FLOOR = 25_000;
const plural = (n: number) => (n === 1 ? "" : "s");

/** Opener (lifetime-tax delta) + up to 3 priority-ordered signal lines. */
export function buildTaxComparisonNarrative(input: TaxComparisonNarrativeInput): string[] {
  const delta = input.scnLifetimeTotal - input.baseLifetimeTotal; // <0 = scenario saves
  const absDelta = Math.abs(delta);
  const pct = input.baseLifetimeTotal > 0 ? Math.round((absDelta / input.baseLifetimeTotal) * 100) : 0;

  let opener: string;
  if (absDelta < 1_000 || pct < 1) {
    opener = `The proposed plan leaves projected lifetime taxes essentially unchanged at ${fmtUsd(input.scnLifetimeTotal)}.`;
  } else if (delta < 0) {
    opener = `The proposed plan lowers projected lifetime taxes by ${fmtUsd(absDelta)} (${pct}%), from ${fmtUsd(input.baseLifetimeTotal)} to ${fmtUsd(input.scnLifetimeTotal)}.`;
  } else {
    opener = `The proposed plan raises projected lifetime taxes by ${fmtUsd(absDelta)} (${pct}%), from ${fmtUsd(input.baseLifetimeTotal)} to ${fmtUsd(input.scnLifetimeTotal)}.`;
  }
  const lines: string[] = [opener];
  const signals: string[] = [];

  // 1. Effective-rate delta (≥ 1 pt).
  const ratePts = Math.round(input.scnEffectiveRate * 100) - Math.round(input.baseEffectiveRate * 100);
  if (Math.abs(ratePts) >= 1) {
    const dir = ratePts < 0 ? "falls" : "rises";
    signals.push(
      `The lifetime effective rate ${dir} ${Math.abs(ratePts)} point${plural(Math.abs(ratePts))}, ${fmtPct(input.baseEffectiveRate)} → ${fmtPct(input.scnEffectiveRate)}.`,
    );
  }

  // 2. Roth shift at retirement (≥ $25k either way).
  const rothDelta = input.scnRothAtRet - input.baseRothAtRet;
  if (rothDelta >= ROTH_SHIFT_FLOOR) {
    signals.push(`By retirement, the proposed plan holds ${fmtUsd(rothDelta)} more in tax-free Roth assets.`);
  } else if (rothDelta <= -ROTH_SHIFT_FLOOR) {
    signals.push(`By retirement, the proposed plan holds ${fmtUsd(Math.abs(rothDelta))} less in Roth assets.`);
  }

  // 3. High-bracket years (bracket mode, count changed).
  if (input.bracketMode && input.scnYearsAboveHigh !== input.baseYearsAboveHigh) {
    const verb = input.scnYearsAboveHigh < input.baseYearsAboveHigh ? "cuts" : "adds";
    signals.push(
      `It ${verb} years above the ${fmtPct(input.highThreshold)} bracket from ${input.baseYearsAboveHigh} to ${input.scnYearsAboveHigh}.`,
    );
  }

  // 4. IRMAA years (count changed).
  if (input.scnIrmaaYears !== input.baseIrmaaYears) {
    signals.push(
      `IRMAA Medicare surcharges apply in ${input.scnIrmaaYears} year${plural(input.scnIrmaaYears)} vs ${input.baseIrmaaYears} in the base case.`,
    );
  }

  // 5. Low-bracket windows (bracket mode, fallback).
  if (input.bracketMode && input.scnYearsBelowLow !== input.baseYearsBelowLow) {
    const dir = input.scnYearsBelowLow > input.baseYearsBelowLow ? "rise" : "fall";
    signals.push(
      `Low-bracket years (below ${fmtPct(input.lowThreshold)}) ${dir} from ${input.baseYearsBelowLow} to ${input.scnYearsBelowLow} — more room for Roth conversions or 0% capital-gains harvesting.`,
    );
  }

  for (const s of signals) {
    if (lines.length >= MAX_LINES) break;
    lines.push(s);
  }
  return lines;
}
