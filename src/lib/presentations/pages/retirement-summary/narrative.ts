// src/lib/presentations/pages/retirement-summary/narrative.ts
import { fmtUsd, fmtPct } from "./aggregate";

export interface RetirementNarrativeInput {
  monteCarloSuccess: number | null;
  liquidEndOfLife: number;
  dominantSource: { label: string; share: number } | null;
  shortfall: number;
  ssDelayGain: { name: string; fromAge: number; toAge: number; pctGain: number } | null;
  rothShare: number; // Roth as a fraction of retirement-year liquid assets
}

const MAX_LINES = 4;

export function buildRetirementNarrative(input: RetirementNarrativeInput): string[] {
  const opener =
    input.monteCarloSuccess != null
      ? `The plan has a ${fmtPct(input.monteCarloSuccess)} Monte Carlo success rate, ending with about ${fmtUsd(input.liquidEndOfLife)} in liquid assets.`
      : `The plan ends with about ${fmtUsd(input.liquidEndOfLife)} in liquid assets at end of life.`;
  const lines: string[] = [opener];
  const signals: string[] = [];

  // 1. Shortfall — highest priority warning.
  if (input.shortfall > 0) {
    signals.push(`Projected spending exceeds available funding by ${fmtUsd(input.shortfall)} over retirement — a shortfall the plan does not currently cover.`);
  }

  // 2. Dominant funding source.
  if (input.dominantSource && input.dominantSource.share > 0) {
    signals.push(`${input.dominantSource.label} is the largest funding source, covering ${fmtPct(input.dominantSource.share)} of lifetime retirement spending.`);
  }

  // 3. Social Security delay value.
  if (input.ssDelayGain && input.ssDelayGain.pctGain > 0) {
    const g = input.ssDelayGain;
    signals.push(`Delaying ${g.name}'s Social Security from ${g.fromAge} to ${g.toAge} would raise the monthly benefit by about ${fmtPct(g.pctGain)}.`);
  }

  // 4. Roth share.
  if (input.rothShare > 0) {
    signals.push(`Roth assets make up ${fmtPct(input.rothShare)} of the retirement-year portfolio — a tax-free reserve for later-life or legacy needs.`);
  }

  for (const s of signals) {
    if (lines.length >= MAX_LINES) break;
    lines.push(s);
  }
  return lines;
}
