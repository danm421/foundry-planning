export interface RothConversionPageOptions {
  /** The plan whose conversions the page explains: "base" or a live scenario id. */
  scenarioId: string;
}

export const ROTH_CONVERSION_OPTIONS_DEFAULT: RothConversionPageOptions = {
  scenarioId: "base",
};

/** One row of the year-by-year table — a year in which something was converted. */
export interface RothConversionYearRow {
  year: number;
  clientAge: number;
  spouseAge: number | null;
  converted: number;
  /** The ordinary-income part of `converted`. Lower only when the source holds
   *  after-tax basis (Form 8606 pro-rata). */
  taxable: number;
  /** This year's total tax with the conversions, less the same year without. */
  extraTax: number;
  /** The bracket the year's income tops out in. "amt" when the minimum tax
   *  binds, so the bracket is not the rate the conversion paid. Null on the
   *  flat tax engine, which has no brackets. */
  bracket: number | "amt" | null;
  /** The Medicare surcharge this year's income moves, two years later — the
   *  year the premium is billed. Null when nobody is on Medicare by then. */
  extraMedicare: number | null;
  /** Why the year converted less than asked, when it did. */
  note: string | null;
}

export interface SavingsMix {
  roth: number;
  preTax: number;
  taxable: number;
  total: number;
}

/** Without / with, side by side. `betterIsLower` says which side to mark. */
export interface LifetimeRow {
  label: string;
  without: number;
  with: number;
  betterIsLower: boolean;
}

/**
 * When the conversions start paying for themselves, measured by what the heirs
 * would receive after tax if the plan ended that year.
 *  - "year": from `year` on, the family stays ahead.
 *  - "immediate": the family is never behind — the conversions are taxed at a
 *    lower rate than the heirs would pay on the same dollars.
 *  - "never": the family is still behind at the end of the plan.
 */
export type RothBreakeven =
  | { kind: "year"; year: number }
  | { kind: "immediate" }
  | { kind: "never" };

export interface RothConversionTotals {
  converted: number;
  /** Extra tax across the conversion years. */
  extraTax: number;
  /** Tax saved across every other year. Negative when later taxes run higher. */
  laterTaxSaved: number;
  /** Medicare surcharges with the conversions, less without. */
  extraMedicare: number;
  /** What the heirs receive after tax at the end of the plan, with less without. */
  heirsChange: number;
}

export interface RothConversionPageData {
  /** Name of the plan carrying the conversions. */
  planLabel: string;
  /** What the page compares against, printed on both sheets. */
  comparisonNote: string;
  /** Set when the page cannot make its comparison; every other field is empty. */
  emptyMessage: string | null;
  /** One plain sentence per conversion. */
  strategy: string[];
  totals: RothConversionTotals | null;
  breakeven: RothBreakeven | null;
  takeaway: string[];
  schedule: RothConversionYearRow[];
  /** Any year where the taxable part differs from the amount converted. */
  showTaxable: boolean;
  /** The plan runs on the bracket tax engine. */
  showBracket: boolean;
  /** With-minus-without of what the heirs receive, by year. */
  advantage: Array<{ year: number; value: number }>;
  lifetime: LifetimeRow[];
  mix: { year: number; with: SavingsMix; without: SavingsMix } | null;
  /** The first year any IRA withdrawal is required, with and without. Also
   *  printed as the last `lifetime` row. */
  rmd: { year: number; clientAge: number; with: number; without: number } | null;
  footnotes: string[];
}
