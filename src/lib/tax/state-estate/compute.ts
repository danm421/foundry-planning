import { STATE_ESTATE_TAX } from "./data";
import { applyCliff, applyMaxCombinedCap } from "./special-rules";
import type { Bracket, BracketLine, GiftAddback as GiftAddbackRule, StateCode, StateEstateTaxResult } from "./types";

export interface ComputeStateEstateTaxInput {
  /** USPS 2-letter code, or null. Codes outside the estate-tax jurisdictions
   *  fall through to the back-compat flat-rate path. */
  state: string | null;
  deathYear: number;
  /** Post-deductions taxable estate (already netted for marital/charitable/admin). */
  taxableEstate: number;
  /** Federal Form 706 line: adjusted taxable gifts. Used as the basis for gift-addback states. */
  adjustedTaxableGifts: number;
  /** Per-gift-year breakdown of adjusted taxable gifts (already net of annual exclusion).
   *  Lets finite-window addback states (ME/VT/MN/NY) include only gifts within their
   *  statutory lookback. When absent, finite-window states fall back to the full scalar. */
  adjustedTaxableGiftsByYear?: Array<{ year: number; amount: number }>;
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
  if (input.state == null || !(input.state in STATE_ESTATE_TAX)) {
    return computeFallback(input);
  }
  const rule = STATE_ESTATE_TAX[input.state as StateCode];

  const giftAddback = computeGiftAddback(
    rule.giftAddback,
    input.adjustedTaxableGifts,
    input.adjustedTaxableGiftsByYear,
    input.deathYear,
  );
  const baseForTax = input.taxableEstate + giftAddback;

  const cliffApp = applyCliff(rule, baseForTax);
  const cliff = rule.cliffPct != null
    ? { applied: cliffApp.applied, threshold: cliffApp.threshold }
    : undefined;

  // For cliff states (NY), brackets run from $0 on the whole estate; a credit
  // zeros the tax below the exemption, then phases linearly to $0 across the band
  // up to the 105% cliff, above which the whole estate is taxable with no credit.
  const isCliffState = rule.cliffPct != null;
  let bracketLines: BracketLine[];
  let amountOverExemption: number;
  // Credit subtracted from the bracket tax to reach final tax:
  //  - NY phase-out band: exemption credit phasing linearly across [exemption, 105%].
  //  - MA: fixed §2011-table-at-$2M credit (rule.fixedCredit), added below.
  let creditReduction = 0;
  let phaseOutBandApplied = false;
  if (isCliffState) {
    const threshold = cliffApp.threshold; // exemption × cliffPct
    if (baseForTax <= rule.exemption) {
      // Below the exemption the phase-out credit fully absorbs the tax.
      bracketLines = [];
      amountOverExemption = 0;
    } else {
      // At/above the exemption the entire estate is the tax base (brackets from $0).
      bracketLines = applyBrackets(rule.brackets, baseForTax);
      amountOverExemption = baseForTax;
      if (!cliffApp.applied) {
        // Phase-out band (exemption < base ≤ 105% cliff): NY Tax Law §952(c)(2).
        // Full-estate tax less a credit that phases linearly from `creditAtExemption`
        // (which zeros the tax at the exemption) down to $0 at the cliff.
        const creditAtExemption = sumBracketTax(applyBrackets(rule.brackets, rule.exemption));
        creditReduction = creditAtExemption * (threshold - baseForTax) / (threshold - rule.exemption);
        phaseOutBandApplied = true;
      }
      // base > threshold (cliff applied): no credit — entire estate taxable.
    }
  } else {
    bracketLines = applyBrackets(rule.brackets, baseForTax);
    amountOverExemption = Math.max(0, baseForTax - rule.exemption);
  }
  // MA-style fixed credit (mutually exclusive with the NY band in practice).
  if (rule.fixedCredit != null) {
    creditReduction += rule.fixedCredit;
  }
  const preCapTax = sumBracketTax(bracketLines);

  const notes: string[] = [];
  notes.push(`Citation: ${rule.citation}`);
  if (rule.indexed) notes.push(`Exemption is indexed (Phase 1 hard-codes ${rule.effectiveYear} value).`);
  if (rule.fixedCredit != null) {
    notes.push(
      `MA §2011 graduated table applied to the full estate; fixed credit of ` +
      `$${rule.fixedCredit.toLocaleString()} subtracted (floor $0).`,
    );
  }
  if (phaseOutBandApplied) {
    notes.push(
      `NY phase-out band: estate is between the exemption ($${rule.exemption.toLocaleString()}) and ` +
      `${(rule.cliffPct! * 100).toFixed(0)}% of it ($${cliffApp.threshold.toLocaleString()}). Whole estate taxed, ` +
      `less a credit of $${round2(creditReduction).toLocaleString()} phasing linearly to $0 at the cliff.`,
    );
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
        `($${giftAddback.toLocaleString()}).`,
      );
    }
  }

  // CT §12-391(g) caps combined lifetime CT gift tax + estate tax. The cumulative CT
  // gift tax paid is not yet threaded into this engine, so we pass 0 for now (the cap
  // still fires on estate-tax-only, unchanged from prior behavior). See future-work.
  const priorCtGiftTax = 0;
  const capApp = applyMaxCombinedCap(rule, preCapTax, priorCtGiftTax);
  const finalTax = Math.max(0, capApp.finalTax - creditReduction);
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
    state: input.state as StateCode,
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
    ...(creditReduction > 0 ? { creditReduction: round2(creditReduction) } : {}),
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

/** Sum the tax across a set of bracket lines. */
function sumBracketTax(lines: BracketLine[]): number {
  return lines.reduce((s, l) => s + l.tax, 0);
}

function computeGiftAddback(
  rule: GiftAddbackRule | null,
  adjustedTaxableGifts: number,
  byYear: Array<{ year: number; amount: number }> | undefined,
  deathYear: number,
): number {
  if (rule == null) return 0;
  // Infinity-window states (CT, HI, IL) add back the full lifetime adjusted-taxable-gifts.
  if (rule.years === Infinity) return Math.max(0, adjustedTaxableGifts);
  // Finite-window states (ME 1yr / VT 2yr / MN,NY 3yr — NY Tax Law §954(a)(3),
  // Minn. Stat. §291.016, 32 VSA §7442a, 36 MRSA §4102) add back only gifts made
  // within `years` of death: deathYear − giftYear ≤ years (boundary inclusive).
  // Without the per-gift-year breakdown we cannot window, so fall back to the full
  // scalar (back-compat — the engine always threads `byYear`).
  if (byYear == null) return Math.max(0, adjustedTaxableGifts);
  const windowed = byYear
    .filter((g) => deathYear - g.year <= rule.years)
    .reduce((sum, g) => sum + g.amount, 0);
  return Math.max(0, windowed);
}
