import type { ProjectionYear } from "@/engine/types";

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
    const tier = taxResult.diag.marginalBracketTier;

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
      marginalRate: taxResult.diag.marginalFederalRate,
      intoBracket,
      remainingInBracket,
      changeInBase,
    });

    prevBase = incomeTaxBase;
  }

  return rows;
}
