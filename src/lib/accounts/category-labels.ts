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
  return (
    ACCOUNT_CATEGORY_LABELS[category] ??
    category
      .split("_")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join(" ")
  );
}
