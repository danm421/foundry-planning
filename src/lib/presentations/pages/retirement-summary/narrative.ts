// src/lib/presentations/pages/retirement-summary/narrative.ts
import { fmtUsd, fmtPct, printsAsZero } from "./aggregate";

export interface RetirementNarrativeInput {
  monteCarloSuccess: number | null;
  liquidEndOfLife: number;
  dominantSource: { label: string; share: number } | null;
  shortfall: number;
  ssDelayGain: { name: string; fromAge: number; toAge: number; pctGain: number } | null;
  rothShare: number; // Roth as a fraction of retirement-year liquid assets
}

/** Takeaways, split by which sheet they belong to. The PDF prints two sheets —
 *  assets/outlook, then income/spending/funding — and printing the same
 *  sentence on both wasted the only vertical slack the second sheet had, which
 *  is what pushed a blank third sheet into the deck. `funding` is captioned
 *  under the funding bar it describes; `outlook` is the takeaway callout on
 *  sheet one. The web summary shows both, one after the other. */
export interface RetirementNarrative {
  outlook: string[];
  funding: string[];
}

const MAX_OUTLOOK_LINES = 3;
const MAX_FUNDING_LINES = 2;

export function buildRetirementNarrative(input: RetirementNarrativeInput): RetirementNarrative {
  const opener =
    input.monteCarloSuccess != null
      ? `The plan has ${fmtPct(input.monteCarloSuccess)} plan confidence, ending with about ${fmtUsd(input.liquidEndOfLife)} in liquid assets.`
      : `The plan ends with about ${fmtUsd(input.liquidEndOfLife)} in liquid assets at end of life.`;

  const outlook: string[] = [opener];
  const funding: string[] = [];

  // ── Funding sheet ──
  // 1. Shortfall — highest priority warning. Guarded on the DISPLAYED figure:
  // see printsAsZero.
  if (!printsAsZero(input.shortfall)) {
    funding.push(`Projected spending exceeds available funding by ${fmtUsd(input.shortfall)} over retirement — a shortfall the plan does not currently cover.`);
  }

  // 2. Dominant funding source.
  if (input.dominantSource && input.dominantSource.share > 0) {
    funding.push(`${input.dominantSource.label} is the largest funding source, covering ${fmtPct(input.dominantSource.share)} of lifetime retirement spending.`);
  }

  // ── Outlook sheet ──
  // 3. Social Security delay value.
  if (input.ssDelayGain && input.ssDelayGain.pctGain > 0) {
    const g = input.ssDelayGain;
    outlook.push(`Delaying ${g.name}'s Social Security from ${g.fromAge} to ${g.toAge} would raise the monthly benefit by about ${fmtPct(g.pctGain)}.`);
  }

  // 4. Roth share.
  if (input.rothShare > 0) {
    outlook.push(`Roth assets make up ${fmtPct(input.rothShare)} of the retirement-year portfolio — a tax-free reserve for later-life or legacy needs.`);
  }

  return {
    outlook: outlook.slice(0, MAX_OUTLOOK_LINES),
    funding: funding.slice(0, MAX_FUNDING_LINES),
  };
}
