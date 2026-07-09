// mobile/src/accounts/labels.ts
//
// Shared category/type label helpers for the Accounts list + detail modal.
// Mirrors the web portal's CATEGORY_LABELS (profile-accounts-list.tsx) and
// TYPE_LABEL (profile-debt-list.tsx) so labels read the same on both surfaces.

const CATEGORY_LABELS: Record<string, string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  annuity: "Annuity",
  real_estate: "Real estate",
  business: "Business",
  stock_options: "Stock options",
  life_insurance: "Life insurance",
  notes_receivable: "Notes receivable",
};

/** Stable display order for the categories the Accounts screen groups by;
 *  any other category present in the data is appended alphabetically after these. */
export const CATEGORY_ORDER = ["cash", "taxable", "retirement", "real_estate"];

const DEBT_TYPE_LABELS: Record<string, string> = {
  mortgage: "Mortgage",
  heloc: "HELOC",
  auto: "Auto loan",
  student: "Student loan",
  personal: "Personal loan",
  credit_card: "Credit card",
  other: "Loan",
};

function titleCaseFallback(value: string): string {
  const spaced = value.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? titleCaseFallback(category);
}

/** Categories present in the data, in CATEGORY_ORDER first, then any
 *  unmapped category alphabetically — so nothing silently disappears. */
export function orderedCategories(present: string[]): string[] {
  const known = CATEGORY_ORDER.filter((c) => present.includes(c));
  const extra = [...new Set(present.filter((c) => !CATEGORY_ORDER.includes(c)))].sort();
  return [...known, ...extra];
}

/** "traditional_ira" -> "traditional ira" — matches the web portal's
 *  unmapped, lowercase subType rendering (profile-accounts-list.tsx). */
export function subTypeLabel(subType: string): string {
  return subType.replace(/_/g, " ");
}

export function debtTypeLabel(liabilityType: string | null): string {
  if (!liabilityType) return "Debt";
  return DEBT_TYPE_LABELS[liabilityType] ?? titleCaseFallback(liabilityType);
}
