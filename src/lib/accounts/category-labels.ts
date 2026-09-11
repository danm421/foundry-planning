// Human-readable labels for account categories (the `account_category` enum).
// Shared so display surfaces (beneficiary summary, etc.) don't reinvent the
// mapping or fall back to raw enum values like "LIFE_INSURANCE".

import type { AccountCategory, AccountSubType } from "@/lib/extraction/types";

/**
 * The curated dropdown choices `review-step-accounts.tsx`'s Category/Type
 * selects offer — a deliberate SUBSET of `ACCOUNT_CATEGORY_LABELS` /
 * `ACCOUNT_SUB_TYPE_LABELS` below (not every enum value is one an advisor
 * picks by hand) with its own hand-tuned label wording. Lives here, not in
 * that component, so a client-only surface (the wizard) doesn't have to be
 * imported by a non-UI consumer just to read this list (Task 10 review,
 * Important 9) — `review-step-accounts.tsx` re-exports both for the wizard's
 * own imports, unchanged.
 */
export const CATEGORY_OPTIONS: { value: AccountCategory; label: string }[] = [
  { value: "taxable", label: "Taxable" },
  { value: "cash", label: "Cash" },
  { value: "retirement", label: "Retirement" },
  { value: "real_estate", label: "Real Estate" },
  { value: "business", label: "Business" },
  { value: "life_insurance", label: "Life Insurance" },
  // Label matches ACCOUNT_CATEGORY_LABELS.education_savings below — reused
  // everywhere else this category displays.
  { value: "education_savings", label: "529 / Education" },
];

export const SUB_TYPE_OPTIONS: { value: AccountSubType; label: string }[] = [
  { value: "brokerage", label: "Brokerage" },
  { value: "savings", label: "Savings" },
  { value: "checking", label: "Checking" },
  { value: "traditional_ira", label: "Traditional IRA" },
  { value: "roth_ira", label: "Roth IRA" },
  { value: "401k", label: "401(k)" },
  { value: "403b", label: "403(b)" },
  { value: "529", label: "529 Plan" },
  { value: "trust", label: "Trust" },
  { value: "other", label: "Other" },
  { value: "primary_residence", label: "Primary Residence" },
  { value: "rental_property", label: "Rental Property" },
  { value: "commercial_property", label: "Commercial Property" },
  { value: "sole_proprietorship", label: "Sole Proprietorship" },
  { value: "partnership", label: "Partnership" },
  { value: "s_corp", label: "S-Corp" },
  { value: "c_corp", label: "C-Corp" },
  { value: "llc", label: "LLC" },
  { value: "term", label: "Term Life" },
  { value: "whole_life", label: "Whole Life" },
  { value: "universal_life", label: "Universal Life" },
  { value: "variable_life", label: "Variable Life" },
];

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
