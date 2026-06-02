import { fmtUsd, fmtPct } from "./aggregate";

export interface TaxNarrativeInput {
  lifetimeTotal: number;
  effectiveRate: number;
  bracketMode: boolean;
  yearsBelowLow: number;
  yearsAboveHigh: number;
  lowThreshold: number;
  highThreshold: number;
  rothConversionTotal: number;
  rothConversionYears: number;
  rothFirstYear: number | null;
  rothLastYear: number | null;
  irmaaYears: number;
  irmaaTotal: number;
  largestGain: { year: number; gain: number; tax: number } | null;
}

const MAX_LINES = 4;

const plural = (n: number) => (n === 1 ? "" : "s");

/** Opener line + up to 3 signal lines, priority-ordered. */
export function buildTaxNarrative(input: TaxNarrativeInput): string[] {
  const lines: string[] = [
    `Over the plan, total taxes are projected at ${fmtUsd(input.lifetimeTotal)} — a ${fmtPct(input.effectiveRate)} lifetime effective rate.`,
  ];

  const signals: string[] = [];

  // 1. Roth conversions
  if (input.rothConversionTotal > 0 && input.rothFirstYear != null && input.rothLastYear != null) {
    const span = input.rothFirstYear === input.rothLastYear
      ? `${input.rothFirstYear}`
      : `${input.rothFirstYear}–${input.rothLastYear}`;
    signals.push(
      `The plan converts ${fmtUsd(input.rothConversionTotal)} to Roth across ${input.rothConversionYears} year${plural(input.rothConversionYears)} (${span}), front-loading tax to build tax-free assets.`,
    );
  }

  // 2. High-bracket years
  if (input.bracketMode && input.yearsAboveHigh > 0) {
    signals.push(
      `${input.yearsAboveHigh} year${plural(input.yearsAboveHigh)} land above the ${fmtPct(input.highThreshold)} bracket — the plan's highest-tax years.`,
    );
  }

  // 3. IRMAA
  if (input.irmaaYears > 0) {
    signals.push(
      `Income triggers IRMAA Medicare surcharges in ${input.irmaaYears} year${plural(input.irmaaYears)}, totaling ${fmtUsd(input.irmaaTotal)}.`,
    );
  }

  // 4. Large capital-gains event. Guard on tax (not just gain): in flat-tax mode
  // capitalGainsTax is always 0, so this would otherwise read "drives $0 of
  // capital-gains tax" for a real realized gain.
  if (input.largestGain && input.largestGain.tax > 0) {
    signals.push(
      `A ${fmtUsd(input.largestGain.gain)} realized gain in ${input.largestGain.year} drives ${fmtUsd(input.largestGain.tax)} of capital-gains tax.`,
    );
  }

  // 5. Low-bracket opportunity years
  if (input.bracketMode && input.yearsBelowLow > 0) {
    signals.push(
      `${input.yearsBelowLow} year${plural(input.yearsBelowLow)} fall below the ${fmtPct(input.lowThreshold)} bracket — windows for additional Roth conversions or 0% capital-gains harvesting.`,
    );
  }

  for (const s of signals) {
    if (lines.length >= MAX_LINES) break;
    lines.push(s);
  }
  return lines;
}
