// src/lib/tax-ledger/character.ts
import type { TaxCharacter } from "./types";

/** Map a raw `taxDetail.bySource[*].type` value to a display TaxCharacter.
 *  QBI is ordinary in character (the §199A deduction is handled separately). */
export function rawTypeToCharacter(rawType: string): TaxCharacter {
  switch (rawType) {
    case "earned_income":
      return "earned";
    case "ordinary_income":
      return "ordinary";
    case "dividends":
      return "qualified_dividends";
    case "capital_gains":
      return "long_term_gain";
    case "stcg":
      return "short_term_gain";
    case "qbi":
      return "ordinary";
    case "tax_exempt":
      return "tax_exempt";
    case "tax_free":
      return "non_taxable";
    default:
      return "ordinary";
  }
}

export const CHARACTER_LABEL: Record<TaxCharacter, string> = {
  ordinary: "Ordinary Income",
  earned: "Earned Income",
  qualified_dividends: "Qualified Dividends",
  long_term_gain: "Long-Term Gain",
  short_term_gain: "Short-Term Gain",
  tax_exempt: "Tax-Exempt",
  social_security: "Social Security",
  deduction: "Deduction",
  non_taxable: "Non-Taxable",
};

/** True when a character increases taxable income. */
export function isTaxableCharacter(c: TaxCharacter): boolean {
  return c !== "deduction" && c !== "tax_exempt" && c !== "non_taxable";
}
