import type { ProjectionYear } from "@/engine/types";
import type { BracketTier } from "./types";
import type { StateIncomeTaxResult } from "./state-income";

export interface TaxBracketRow {
  year: number;
  clientAge: number;
  spouseAge: number | null;
  conversionGross: number;
  conversionTaxable: number;
  incomeTaxBase: number;
  marginalRate: number;
  /** Income filling the marginal tier above its `from`. */
  intoBracket: number;
  /** Headroom remaining in the marginal tier. `null` for the top tier
   *  (`to === null`) — caller renders an em-dash. */
  remainingInBracket: number | null;
  /** YoY change in `incomeTaxBase`. First year = 0. Negative is allowed. */
  changeInBase: number;
}

/**
 * Pick the bracket tier `incomeTaxBase` *currently sits in* — the rate the
 * household's last dollar paid into. Differs from `findMarginalTier` (the
 * "next dollar" rate) only at the exact `tier.to` boundary: a perfect
 * fill_up_bracket conversion that lands `incomeTaxBase` at the 22% ceiling
 * would otherwise classify as 24% (rate of the next dollar). Advisor
 * intuition is "I filled 22%, so my bracket is 22%" — match that.
 */
function pickFilledTier(
  incomeTaxBase: number,
  brackets: BracketTier[] | undefined,
): BracketTier | null {
  if (!brackets || brackets.length === 0) return null;
  if (incomeTaxBase < 0) return brackets[0];
  for (const tier of brackets) {
    const top = tier.to ?? Infinity;
    if (incomeTaxBase <= top) return tier;
  }
  return brackets[brackets.length - 1];
}

export function buildTaxBracketRows(years: ProjectionYear[]): TaxBracketRow[] {
  const rows: TaxBracketRow[] = [];
  let prevBase: number | null = null;

  for (const year of years) {
    const taxResult = year.taxResult;
    if (!taxResult) {
      // No tax computation for this year — skip rather than fabricate.
      // Shouldn't happen in normal projections.
      continue;
    }

    const incomeTaxBase = taxResult.flow.incomeTaxBase;
    const brackets = taxResult.diag.incomeBracketsForFiling;
    // Reclassify with "filled tier" semantics (inclusive at tier.to) so a
    // perfect bracket-fill reads as the targeted tier, not the next one up.
    // Engine math (marginalFederalRate, tax calc) keeps its "next dollar"
    // semantics — this affects display only.
    const tier =
      pickFilledTier(incomeTaxBase, brackets) ??
      taxResult.diag.marginalBracketTier;

    const conversionGross = (year.rothConversions ?? []).reduce(
      (sum, c) => sum + c.gross,
      0,
    );
    const conversionTaxable = (year.rothConversions ?? []).reduce(
      (sum, c) => sum + c.taxable,
      0,
    );

    const intoBracket = Math.max(0, incomeTaxBase - tier.from);
    const remainingInBracket =
      tier.to == null ? null : Math.max(0, tier.to - incomeTaxBase);

    const changeInBase = prevBase == null ? 0 : incomeTaxBase - prevBase;

    rows.push({
      year: year.year,
      clientAge: year.ages.client,
      spouseAge: year.ages.spouse ?? null,
      conversionGross,
      conversionTaxable,
      incomeTaxBase,
      marginalRate: tier.rate,
      intoBracket,
      remainingInBracket,
      changeInBase,
    });

    prevBase = incomeTaxBase;
  }

  return rows;
}

export interface StateBracketRow {
  year: number;
  clientAge: number;
  spouseAge: number | null;
  stateCode: string | null;
  stateTaxableIncome: number;
  marginalRate: number;
  intoBracket: number;
  remainingInBracket: number | null;
  stateTax: number;
  changeInBase: number;
}

export function pickStateMarginalTier(
  taxableIncome: number,
  brackets: StateIncomeTaxResult["bracketsUsed"],
): BracketTier | null {
  if (brackets.length === 0) return null;
  for (const tier of brackets) {
    const lowerOk = taxableIncome >= tier.from;
    const upperOk = tier.to == null || taxableIncome < tier.to;
    if (lowerOk && upperOk) return tier;
  }
  return brackets[brackets.length - 1];
}

export function buildStateBracketRows(years: ProjectionYear[]): StateBracketRow[] {
  const rows: StateBracketRow[] = [];
  let prevBase: number | null = null;

  for (const year of years) {
    const state = year.taxResult?.state;
    if (!state) continue;

    const base = state.stateTaxableIncome;
    const tier = pickStateMarginalTier(base, state.bracketsUsed);
    const intoBracket = tier ? Math.max(0, base - tier.from) : 0;
    const remainingInBracket =
      tier && tier.to != null ? Math.max(0, tier.to - base) : null;
    const changeInBase = prevBase == null ? 0 : base - prevBase;

    rows.push({
      year: year.year,
      clientAge: year.ages.client,
      spouseAge: year.ages.spouse ?? null,
      stateCode: state.state,
      stateTaxableIncome: base,
      marginalRate: tier?.rate ?? 0,
      intoBracket,
      remainingInBracket,
      stateTax: state.stateTax,
      changeInBase,
    });

    prevBase = base;
  }

  return rows;
}
