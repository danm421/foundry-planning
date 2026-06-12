import { fmtUsd, fmtPct } from "./aggregate";

export interface MedicareNarrativeInput {
  lifetimeMedicareCost: number;
  lifetimeIrmaa: number;
  irmaaShare: number;
  irmaaYears: number;
  rmdEra: { firstYear: number; lastYear: number; total: number } | null;
  survivor: { year: number; fromTier: number; toTier: number; total: number } | null;
  headroom: { year: number; amount: number; nextTier: number } | null;
}

const MAX_LINES = 4;

/** Opener line + up to 3 signal lines, priority-ordered (survivor → RMD → cliff). */
export function buildMedicareNarrative(input: MedicareNarrativeInput): string[] {
  const opener =
    input.irmaaYears === 0
      ? `Over the plan, the household pays ${fmtUsd(input.lifetimeMedicareCost)} in Medicare premiums; no year triggers an IRMAA income surcharge.`
      : `Over the plan, the household pays ${fmtUsd(input.lifetimeMedicareCost)} in Medicare premiums — ${fmtPct(input.irmaaShare)} of it (${fmtUsd(input.lifetimeIrmaa)}) is IRMAA, the income-driven surcharge.`;

  const lines: string[] = [opener];
  const signals: string[] = [];

  if (input.survivor) {
    signals.push(
      `At the first death, filing shifts to single; by ${input.survivor.year} the survivor jumps from tier ${input.survivor.fromTier} to tier ${input.survivor.toTier}, adding ~${fmtUsd(input.survivor.total)} in surcharges through end of plan.`,
    );
  }
  if (input.rmdEra) {
    signals.push(
      `Required minimum distributions push the household to tier 2 or higher every year from ${input.rmdEra.firstYear}–${input.rmdEra.lastYear}, adding ${fmtUsd(input.rmdEra.total)} in IRMAA — Roth conversions before RMDs begin could reduce it.`,
    );
  }
  if (input.headroom) {
    signals.push(
      `IRMAA is a cliff, not a phase-in: in ${input.headroom.year} the household is only ${fmtUsd(input.headroom.amount)} under the tier ${input.headroom.nextTier} threshold, and surcharges reflect MAGI from two years earlier — so managing income now sets premiums two years out.`,
    );
  }

  for (const sgnl of signals) {
    if (lines.length >= MAX_LINES) break;
    lines.push(sgnl);
  }
  return lines;
}
