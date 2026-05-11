import { STATE_ESTATE_TAX } from "./data";
import type { Bracket, BracketLine, StateCode, StateEstateTaxResult } from "./types";

export interface ComputeStateEstateTaxInput {
  state: StateCode | null;
  deathYear: number;
  /** Post-deductions taxable estate (already netted for marital/charitable/admin). */
  taxableEstate: number;
  /** Federal Form 706 line: adjusted taxable gifts. Used as the basis for gift-addback states. */
  adjustedTaxableGifts: number;
  /** Back-compat: when state is null and this is > 0, applied as a flat rate to taxableEstate. */
  fallbackFlatRate: number;
}

const EMPTY: StateEstateTaxResult = {
  state: null,
  fallbackUsed: false,
  fallbackRate: 0,
  exemption: 0,
  exemptionYear: 0,
  giftAddback: 0,
  baseForTax: 0,
  amountOverExemption: 0,
  bracketLines: [],
  preCapTax: 0,
  stateEstateTax: 0,
  notes: [],
};

export function computeStateEstateTax(input: ComputeStateEstateTaxInput): StateEstateTaxResult {
  if (input.state == null) {
    return computeFallback(input);
  }
  const rule = STATE_ESTATE_TAX[input.state];

  const giftAddback = 0;
  const baseForTax = input.taxableEstate + giftAddback;
  const amountOverExemption = Math.max(0, baseForTax - rule.exemption);

  const bracketLines = applyBrackets(rule.brackets, baseForTax);
  const preCapTax = bracketLines.reduce((s, l) => s + l.tax, 0);

  const notes: string[] = [];
  notes.push(`Citation: ${rule.citation}`);
  if (rule.indexed) notes.push(`Exemption is indexed (Phase 1 hard-codes ${rule.effectiveYear} value).`);

  return {
    state: input.state,
    fallbackUsed: false,
    fallbackRate: 0,
    exemption: rule.exemption,
    exemptionYear: rule.effectiveYear,
    giftAddback,
    baseForTax,
    amountOverExemption,
    bracketLines,
    preCapTax,
    stateEstateTax: Math.max(0, preCapTax),
    notes,
  };
}

function computeFallback(input: ComputeStateEstateTaxInput): StateEstateTaxResult {
  const rate = input.fallbackFlatRate;
  const tax = Math.max(0, input.taxableEstate * rate);
  return {
    ...EMPTY,
    fallbackUsed: rate > 0,
    fallbackRate: rate,
    baseForTax: input.taxableEstate,
    stateEstateTax: tax,
    preCapTax: tax,
    notes: rate > 0 ? [`Custom flat rate of ${(rate * 100).toFixed(2)}% applied.`] : [],
  };
}

/** Apply graduated brackets to a base amount. Brackets must be sorted ascending by `from`. */
export function applyBrackets(brackets: Bracket[], baseForTax: number): BracketLine[] {
  const lines: BracketLine[] = [];
  for (const b of brackets) {
    if (baseForTax <= b.from) break;
    const upper = b.to ?? baseForTax;
    const top = Math.min(baseForTax, upper);
    const amountTaxed = Math.max(0, top - b.from);
    if (amountTaxed <= 0) continue;
    lines.push({
      from: b.from,
      to: upper,
      rate: b.rate,
      amountTaxed,
      tax: round2(amountTaxed * b.rate),
    });
  }
  return lines;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
