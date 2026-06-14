import { STATE_ESTATE_TAX } from "./data";
import { applyCliff, applyMaxCombinedCap } from "./special-rules";
import type { Bracket, BracketLine, GiftAddback as GiftAddbackRule, StateCode, StateEstateTaxResult, StateEstateTaxRule } from "./types";

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
  /** Plan tax-inflation rate (decimal). Used to forward-project indexed-exemption
   *  states (CT/DC/ME/NY/RI/WA) from their `effectiveYear` to `deathYear` (F16).
   *  When omitted or 0 — or for non-indexed states — projection is a no-op and the
   *  hard-coded `effectiveYear` exemption is used unchanged (back-compat). */
  inflationRate?: number;
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
  const baseRule = STATE_ESTATE_TAX[input.state as StateCode];
  // F16: indexed-exemption states (CT/DC/ME/NY/RI/WA) freeze the exemption at the
  // statutory `effectiveYear` value in `data.ts`. Project it forward to the death
  // year so out-year deaths use a true indexed exemption rather than a stale one
  // (which would OVERSTATE state estate tax). No-op when the rule isn't indexed,
  // no inflation rate is threaded, or the death is at/before the effective year.
  const { rule, projectedExemption } = projectIndexedRule(
    baseRule,
    input.deathYear,
    input.inflationRate ?? 0,
  );

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
  if (rule.indexed) {
    if (projectedExemption != null) {
      notes.push(
        `Exemption is indexed; projected from the ${baseRule.effectiveYear} value ` +
        `($${baseRule.exemption.toLocaleString()}) to ${input.deathYear} at ` +
        `${(input.inflationRate! * 100).toFixed(1)}% → $${rule.exemption.toLocaleString()}.`,
      );
    } else {
      notes.push(`Exemption is indexed; using the ${baseRule.effectiveYear} value (no projection).`);
    }
  }
  if (rule.fixedCredit != null) {
    notes.push(
      `Pre-2002 IRC §2011 graduated table applied to the full estate; fixed credit of ` +
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
    // When the exemption was projected, the value reflects the death year, not the
    // statutory base year — surface the death year so the audit report is honest.
    exemptionYear: projectedExemption != null ? input.deathYear : rule.effectiveYear,
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

/** Indexed state-exemption rounding step. The indexed-exemption states round their
 *  applicable exclusion to the nearest $10k (NY §952, CT §12-391, ME, RI, WA, DC). */
const STATE_EXEMPTION_STEP = 10_000;

/**
 * F16: project an indexed-exemption rule's exclusion forward from its statutory
 * `effectiveYear` to `deathYear`. Mirrors the forward-projection convention used by
 * the gift annual-exclusion resolver (`resolveAnnualExclusion`): compound at the plan
 * inflation rate, then round to the nearest step — here $10k, matching the statutory
 * rounding for these states' exclusions (vs. the resolver's $1k gift-exclusion step).
 *
 * Returns the (possibly projected) rule plus the projected exemption value, or null
 * when no projection occurred (non-indexed state, zero rate, or death at/before the
 * effective year — a 0-year projection is a no-op). For non-cliff states the entire
 * bracket schedule is anchored at the exemption (bottom bracket `from` == exemption),
 * so it is shifted by the same delta to preserve the relative bracket structure. NY
 * (the only cliff state) runs its brackets from $0 and keys the cliff/credit math off
 * `rule.exemption` directly, so only the exemption is projected — its bracket bounds
 * stay anchored at $0.
 */
function projectIndexedRule(
  rule: StateEstateTaxRule,
  deathYear: number,
  inflationRate: number,
): { rule: StateEstateTaxRule; projectedExemption: number | null } {
  if (!rule.indexed || inflationRate <= 0) return { rule, projectedExemption: null };
  const yearsForward = deathYear - rule.effectiveYear;
  if (yearsForward <= 0) return { rule, projectedExemption: null };

  const raw = rule.exemption * Math.pow(1 + inflationRate, yearsForward);
  const projectedExemption = Math.round(raw / STATE_EXEMPTION_STEP) * STATE_EXEMPTION_STEP;
  if (projectedExemption === rule.exemption) return { rule, projectedExemption: null };

  // Cliff states (NY): brackets run from $0; only the exemption is indexed.
  if (rule.cliffPct != null) {
    return { rule: { ...rule, exemption: projectedExemption }, projectedExemption };
  }
  // Non-cliff states: shift the exemption-anchored bracket schedule by the same delta.
  const delta = projectedExemption - rule.exemption;
  const brackets = rule.brackets.map((b) => ({
    from: b.from + delta,
    to: b.to == null ? null : b.to + delta,
    rate: b.rate,
  }));
  return { rule: { ...rule, exemption: projectedExemption, brackets }, projectedExemption };
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
