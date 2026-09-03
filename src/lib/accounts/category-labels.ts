// Human-readable labels for account categories (the `account_category` enum).
// Shared so display surfaces (beneficiary summary, etc.) don't reinvent the
// mapping or fall back to raw enum values like "LIFE_INSURANCE".

export const ACCOUNT_CATEGORY_LABELS: Record<string, string> = {
  taxable: "Taxable",
  cash: "Cash",
  retirement: "Retirement",
  annuity: "Annuity",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
  notes_receivable: "Notes Receivable",
  stock_options: "Stock Options",
  education_savings: "529 / Education",
};

/**
 * Format an account category for display. Known categories map to their
 * curated label; any unknown value degrades gracefully to a title-cased,
 * underscore-free string (e.g. "foo_bar" → "Foo Bar") rather than the raw enum.
 */
export function formatAccountCategory(category: string): string {
  return ACCOUNT_CATEGORY_LABELS[category] ?? titleCase(category);
}

/** Curated labels for the common `subType` values (the add-account form's
 *  vocabulary); anything else title-cases like the category fallback. */
export const ACCOUNT_SUB_TYPE_LABELS: Record<string, string> = {
  brokerage: "Brokerage",
  savings: "Savings",
  checking: "Checking",
  money_market: "Money Market",
  traditional_ira: "Traditional IRA",
  roth_ira: "Roth IRA",
  "401k": "401(k)",
  roth_401k: "Roth 401(k)",
  "403b": "403(b)",
  "457b": "457(b)",
  sep_ira: "SEP IRA",
  simple_ira: "SIMPLE IRA",
  "529": "529 Plan",
  hsa: "HSA",
  trust: "Trust",
  other: "Other",
  primary_residence: "Primary Residence",
  rental_property: "Rental Property",
  commercial_property: "Commercial Property",
  sole_proprietorship: "Sole Proprietorship",
  partnership: "Partnership",
  s_corp: "S Corp",
  c_corp: "C Corp",
  llc: "LLC",
  term: "Term Life",
  whole_life: "Whole Life",
  universal_life: "Universal Life",
  variable_life: "Variable Life",
  non_qualified: "Non-qualified",
  qualified: "Qualified",
  tax_free: "Tax-free",
};

export function formatAccountSubType(subType: string): string {
  return ACCOUNT_SUB_TYPE_LABELS[subType] ?? titleCase(subType);
}

function titleCase(token: string): string {
  return token
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
