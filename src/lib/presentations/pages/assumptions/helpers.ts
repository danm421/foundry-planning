import type { GrowthSource } from "@/lib/investments/allocation";
import type { AssetClassWeight } from "@/lib/investments/benchmarks";
import type { Account } from "@/engine/types";

/** Decimal → one-decimal percent, e.g. 0.062 → "6.2%". "—" for non-finite. */
export function formatPct(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

/** Weighted sum of per-class geometric returns. Classes missing from `geoByClassId`
 *  contribute 0 (their weight is effectively unmodeled). */
export function blendReturn(
  weights: AssetClassWeight[],
  geoByClassId: Map<string, number>,
): number {
  let sum = 0;
  for (const w of weights) sum += w.weight * (geoByClassId.get(w.assetClassId) ?? 0);
  return sum;
}

export function growthSourceLabel(
  acct: { growthSource: GrowthSource; modelPortfolioId: string | null },
  portfolioNameById: Map<string, string>,
): string {
  switch (acct.growthSource) {
    case "model_portfolio":
      return `Model: ${acct.modelPortfolioId ? portfolioNameById.get(acct.modelPortfolioId) ?? "—" : "—"}`;
    case "ticker_portfolio":
      return "Fund portfolio";
    case "asset_mix":
      return "Asset mix";
    case "inflation":
      return "Inflation";
    case "custom":
      return "Custom";
    default:
      return "Plan default";
  }
}

const CATEGORY_LABELS: Record<Account["category"], string> = {
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

export function accountCategoryLabel(category: Account["category"]): string {
  return CATEGORY_LABELS[category] ?? category;
}

/** The six plan-level category rows, in display order, keyed to PlanGrowthDefaults. */
export const CATEGORY_GROWTH_ORDER = [
  { key: "taxable", label: "Taxable" },
  { key: "cash", label: "Cash" },
  { key: "retirement", label: "Retirement" },
  { key: "realEstate", label: "Real Estate" },
  { key: "business", label: "Business" },
  { key: "lifeInsurance", label: "Life Insurance" },
] as const;
