import { STATE_ESTATE_TAX } from "./data";
import { applyCliff, applyMaxCombinedCap } from "./special-rules";
import type { Bracket, BracketLine, GiftAddback as GiftAddbackRule, StateCode, StateEstateTaxResult } from "./types";

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

  const giftAddback = computeGiftAddback(rule.giftAddback, input.adjustedTaxableGifts);
  const baseForTax = input.taxableEstate + giftAddback;

  const cliffApp = applyCliff(rule, baseForTax);
  const cliff = rule.cliffPct != null
    ? { applied: cliffApp.applied, threshold: cliffApp.threshold }
    : undefined;

  // For cliff states, brackets start at $0 and a credit zeros out tax below the
  // exemption. Above the cliff the credit vanishes, so the whole estate is taxable.
  const isCliffState = rule.cliffPct != null;
  let bracketLines: BracketLine[];
  let amountOverExemption: number;
  if (isCliffState && !cliffApp.applied) {
    bracketLines = applyBrackets(
      shiftBracketsAboveExemption(rule.brackets, rule.exemption),
      baseForTax,
    );
    amountOverExemption = Math.max(0, baseForTax - rule.exemption);
  } else if (isCliffState && cliffApp.applied) {
    bracketLines = applyBrackets(rule.brackets, baseForTax);
    amountOverExemption = baseForTax;
  } else {
    bracketLines = applyBrackets(rule.brackets, baseForTax);
    amountOverExemption = Math.max(0, baseForTax - rule.exemption);
  }
  const preCapTax = bracketLines.reduce((s, l) => s + l.tax, 0);

  const notes: string[] = [];
  notes.push(`Citation: ${rule.citation}`);
  if (rule.indexed) notes.push(`Exemption is indexed (Phase 1 hard-codes ${rule.effectiveYear} value).`);
  const antiCliffCreditApplied = rule.antiCliff === true;
  if (antiCliffCreditApplied) {
    notes.push(`MA anti-cliff exclusion applied: first $${rule.exemption.toLocaleString()} not taxed.`);
  }
  if (isCliffState && cliffApp.applied) {
    notes.push(
      `NY 105% cliff applied: taxable estate exceeds ${(rule.cliffPct! * 100).toFixed(0)}% of exemption ` +
      `($${cliffApp.threshold.toLocaleString()}). Entire estate is taxable.`,
    );
  }
  if (giftAddback > 0 && rule.giftAddback) {
    if (rule.giftAddback.years === Infinity) {
      notes.push(`Gift addback: all federal taxable gifts ($${giftAddback.toLocaleString()}).`);
    } else {
      notes.push(
        `Gift addback: federal taxable gifts within ${rule.giftAddback.years} year(s) of death ` +
        `(Phase 1 uses full $${giftAddback.toLocaleString()}; lookback narrowing is Phase 3).`,
      );
    }
  }

  const capApp = applyMaxCombinedCap(rule, preCapTax);
  const finalTax = capApp.finalTax;
  const cap = rule.capCombined != null
    ? { applied: capApp.applied, cap: capApp.cap, reduction: capApp.reduction }
    : undefined;
  if (capApp.applied) {
    notes.push(
      `Max combined estate+gift tax cap of $${capApp.cap.toLocaleString()} applied; ` +
      `pre-cap tax was $${preCapTax.toLocaleString()}.`,
    );
  }

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
    ...(cap !== undefined ? { cap } : {}),
    ...(cliff !== undefined ? { cliff } : {}),
    ...(rule.antiCliff ? { antiCliffCreditApplied: true } : {}),
    stateEstateTax: Math.max(0, finalTax),
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

function computeGiftAddback(rule: GiftAddbackRule | null, adjustedTaxableGifts: number): number {
  if (rule == null) return 0;
  // Phase 1: no per-year gift ledger is threaded through, so years:Infinity and
  // finite-year windows both apply the full adjustedTaxableGifts. Narrow-window
  // resolution is Phase 3.
  return Math.max(0, adjustedTaxableGifts);
}

/** Shift bracket lower bounds up by the exemption to display only above-exemption bands. */
function shiftBracketsAboveExemption(brackets: Bracket[], exemption: number): Bracket[] {
  return brackets
    .map((b) => ({
      from: Math.max(b.from, exemption),
      to: b.to,
      rate: b.rate,
    }))
    .filter((b) => b.to == null || b.from < b.to);
}
