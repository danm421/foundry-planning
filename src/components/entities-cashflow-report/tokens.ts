const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const formatCurrency = (n: number): string => {
  if (n === 0) return "$0";
  return fmt.format(n);
};

/** Each label is two lines. Short labels get an empty first line ("") so
 *  every header occupies the same height — that way the rendered text always
 *  bottom-aligns regardless of `vertical-align` quirks across browsers. */
export const TRUST_COLUMNS = [
  { key: "year",                label: ["", "Year"] },
  { key: "ages",                label: ["", "Age"] },
  { key: "beginningBalance",    label: ["Beginning of", "Year Balance"] },
  { key: "transfersIn",         label: ["Transfers", "In"] },
  { key: "growth",              label: ["", "Growth"] },
  { key: "income",              label: ["", "Income"] },
  { key: "totalDistributions",  label: ["Total", "Distributions"] },
  { key: "expenses",            label: ["", "Expenses"] },
  { key: "taxes",               label: ["", "Taxes"] },
  { key: "endingBalance",       label: ["End of Year", "Balance"] },
] as const;

export const BUSINESS_COLUMNS = [
  { key: "year",                label: ["", "Year"] },
  { key: "ages",                label: ["", "Age"] },
  { key: "beginningTotalValue", label: ["Beginning of Year", "Total Value"] },
  { key: "beginningBasis",      label: ["Beginning of", "Year Basis"] },
  { key: "growth",              label: ["Business", "Growth"] },
  { key: "income",              label: ["Business", "Income"] },
  { key: "expenses",            label: ["Business", "Expenses"] },
  { key: "annualDistribution",  label: ["Annual", "Distribution"] },
  { key: "retainedEarnings",    label: ["Retained", "Earnings"] },
  { key: "endingTotalValue",    label: ["End of Year", "Total Value"] },
  { key: "endingBasis",         label: ["End of Year", "Basis"] },
] as const;

export const formatAges = (a: { client: number; spouse?: number | null }): string =>
  a.spouse != null ? `${a.client}/${a.spouse}` : String(a.client);
