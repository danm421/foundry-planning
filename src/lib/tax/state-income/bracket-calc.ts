// src/lib/tax/state-income/bracket-calc.ts
import type { BracketTier } from "@/lib/tax/types";

export function applyBrackets(taxable: number, tiers: BracketTier[]): number {
  if (taxable <= 0 || tiers.length === 0) return 0;
  let tax = 0;
  for (const tier of tiers) {
    const top = tier.to ?? Infinity;
    if (taxable <= tier.from) break;
    const slice = Math.min(taxable, top) - tier.from;
    if (slice > 0) tax += slice * tier.rate;
  }
  return tax;
}

export function marginalRate(taxable: number, tiers: BracketTier[]): number {
  if (taxable <= 0 || tiers.length === 0) return 0;
  for (const tier of tiers) {
    const top = tier.to ?? Infinity;
    if (taxable < top) return tier.rate;
  }
  return tiers[tiers.length - 1].rate;
}
