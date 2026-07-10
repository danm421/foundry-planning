import type { IrmaaTier, TaxYearParameters } from "@/lib/tax/types";
import type { TaxReturnFacts } from "@/lib/schemas/tax-return-facts";

/** IRMAA MAGI = AGI + tax-exempt interest (SSA-44 definition). */
export function computeMagi(facts: TaxReturnFacts): number | null {
  if (facts.income.agi == null) return null;
  return facts.income.agi + (facts.income.taxExemptInterest ?? 0);
}

export function irmaaTiersFor(
  facts: TaxReturnFacts,
  irmaaParams: TaxYearParameters,
): IrmaaTier[] | null {
  const tiers =
    facts.filingStatus === "married_joint"
      ? irmaaParams.irmaaBracketsMfj
      : irmaaParams.irmaaBracketsSingle;
  return tiers && tiers.length > 0 ? tiers : null;
}

/** Lower-exclusive / upper-inclusive per 20 CFR 418.2120 — mirrors
 *  src/engine/medicare.ts pickTier semantics. */
export function currentIrmaaTier(
  magi: number,
  tiers: IrmaaTier[],
): { tier: number; lower: number; upper: number | null; partB: number; partD: number } {
  for (const t of tiers) {
    if (magi > t.magiLowerBound && (t.magiUpperBound === null || magi <= t.magiUpperBound)) {
      return { tier: t.tier, lower: t.magiLowerBound, upper: t.magiUpperBound, partB: t.partBSurcharge, partD: t.partDSurcharge };
    }
  }
  return { tier: 0, lower: 0, upper: tiers[0]?.magiLowerBound ?? null, partB: 0, partD: 0 };
}

/** Distance UP to the next surcharge boundary; null when in the top tier. */
export function nextIrmaaCliff(
  magi: number,
  tiers: IrmaaTier[],
): { bound: number; distance: number } | null {
  const boundaries = tiers.map((t) => t.magiLowerBound).sort((a, b) => a - b);
  const next = boundaries.find((b) => magi <= b);
  return next == null ? null : { bound: next, distance: next - magi };
}
