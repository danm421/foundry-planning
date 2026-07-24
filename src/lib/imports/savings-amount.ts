/**
 * The shapes a savings amount can take. Exactly one style is populated per
 * parse: a flat dollar amount, a percent-of-salary deferral, or a tiered
 * employer match.
 */
export interface SavingsAmount {
  annualAmount?: number;
  annualPercent?: number;
  employerMatchPct?: number;
  employerMatchCap?: number;
}

/** "50.0% of the first 6.0% of ..." - checked FIRST; it also matches TIERED. */
const TIERED = /(\d+(?:\.\d+)?)\s*%\s*of\s+the\s+first\s+(\d+(?:\.\d+)?)\s*%/i;
/** "10.0% of salary" */
const PERCENT_OF_SALARY = /(\d+(?:\.\d+)?)\s*%\s*of\s+(?:the\s+)?(?:employee(?:'s)?\s+)?salary/i;
/** "$12,000 per year" / "$12,000 annually" */
const FLAT_ANNUAL = /\$?\s*([\d,]+(?:\.\d+)?)\s*(?:per\s+year|\/\s*year|annually|a\s+year)/i;

/**
 * Parse an "Amount" cell from a savings/contributions table into engine fields.
 *
 * Order matters: the tiered form contains a bare "N% of ... salary" substring,
 * so it must be tested before PERCENT_OF_SALARY or a 50%-on-6% match would be
 * misread as a 50%-of-salary deferral.
 *
 * If a cell contains both a percent-of-salary clause and a dollar amount
 * (e.g., "$3,000 per year (approximately 5% of salary)"), returns null to avoid
 * silently dropping one. The caller keeps whatever the model emitted rather than
 * receiving an ambiguous or wrong number.
 *
 * Returns null when the text matches none of the known forms - the caller keeps
 * whatever the model emitted rather than inventing a number.
 */
export function parseSavingsAmount(text: string): SavingsAmount | null {
  if (!text) return null;

  const tiered = TIERED.exec(text);
  if (tiered) {
    return {
      employerMatchPct: Number(tiered[1]) / 100,
      employerMatchCap: Number(tiered[2]) / 100,
    };
  }

  // Guard against ambiguity: if both percent-of-salary and dollar amount are
  // present, return null rather than silently dropping one.
  const hasDollars = FLAT_ANNUAL.test(text);
  const hasPercent = PERCENT_OF_SALARY.test(text);
  if (hasDollars && hasPercent) return null;

  const pct = PERCENT_OF_SALARY.exec(text);
  if (pct) return { annualPercent: Number(pct[1]) / 100 };

  const flat = FLAT_ANNUAL.exec(text);
  if (flat) {
    const amount = Number(flat[1].replace(/,/g, ""));
    if (Number.isFinite(amount)) return { annualAmount: amount };
  }

  return null;
}
