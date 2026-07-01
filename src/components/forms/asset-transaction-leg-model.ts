import type { Account } from "@/engine/types";

export type AssetCategory =
  | "taxable" | "cash" | "retirement"
  | "real_estate" | "business" | "life_insurance";

export type SellAmountMode = "full" | "percent" | "dollar";
export type SellSourceMode = "account" | "business";

export interface SellLegDraft {
  key: string;              // stable client key for list rendering
  recordId?: string;        // set in edit mode → the record this leg writes back to
  kind: "sell";
  name: string;             // per-leg record name (derived, editable)
  sellMode: SellSourceMode;
  sellAccountId: string;
  sellPurchaseTransactionId: string;
  sellBusinessAccountId: string;
  sellAmountMode: SellAmountMode;
  fractionSoldPct: string;      // "0".."100"
  overrideSaleValue: string;
  overrideBasis: string;
  transactionCostPct: string;   // percent string, e.g. "6"
  transactionCostFlat: string;
  proceedsAccountId: string;
  qualifiesForHomeSaleExclusion: boolean;
}

export interface BuyLegDraft {
  key: string;
  recordId?: string;
  kind: "buy";
  name: string;
  assetName: string;
  assetCategory: AssetCategory;
  assetSubType: string;
  purchasePrice: string;
  growthRate: string;           // percent string
  basis: string;
  fundingAccountId: string;     // "" | "__from_sale_proceeds__" | accountId
  showMortgage: boolean;
  mortgageAmount: string;
  mortgageRate: string;         // percent string
  mortgageTermMonths: string;   // "360"
}

export type LegDraft = SellLegDraft | BuyLegDraft;

// Ported verbatim from add-asset-transaction-form.tsx lines 106-152.
export const SUB_TYPE_BY_CATEGORY: Record<AssetCategory, string[]> = {
  taxable: ["brokerage", "trust", "other"],
  cash: ["savings", "checking", "other"],
  retirement: ["traditional_ira", "roth_ira", "401k", "403b", "529", "trust", "other"],
  real_estate: ["primary_residence", "rental_property", "commercial_property"],
  business: ["sole_proprietorship", "partnership", "s_corp", "c_corp", "llc"],
  life_insurance: ["term", "whole_life", "universal_life", "variable_life"],
};
export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  taxable: "Taxable", cash: "Cash", retirement: "Retirement",
  real_estate: "Real Estate", business: "Business", life_insurance: "Life Insurance",
};
export const SUB_TYPE_LABELS: Record<string, string> = {
  brokerage: "Brokerage", savings: "Savings", checking: "Checking",
  traditional_ira: "Traditional IRA", roth_ira: "Roth IRA", "401k": "401(k)",
  "403b": "403(b)", "529": "529 Plan", trust: "Trust", other: "Other",
  primary_residence: "Primary Residence", rental_property: "Rental Property",
  commercial_property: "Commercial Property", sole_proprietorship: "Sole Proprietorship",
  partnership: "Partnership", s_corp: "S Corp", c_corp: "C Corp", llc: "LLC",
  term: "Term Life", whole_life: "Whole Life", universal_life: "Universal Life",
  variable_life: "Variable Life",
};
export const FUNDING_SPECIAL_OPTIONS = [
  { value: "", label: "Withdrawal Strategy" },
  { value: "__from_sale_proceeds__", label: "From Sale Proceeds" },
];

export function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  }).format(num);
}
export function parseNum(v: string | undefined | null): number {
  if (!v) return 0;
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

export function emptySellLeg(key: string): SellLegDraft {
  return {
    key, kind: "sell", name: "", sellMode: "account",
    sellAccountId: "", sellPurchaseTransactionId: "", sellBusinessAccountId: "",
    sellAmountMode: "full", fractionSoldPct: "100",
    overrideSaleValue: "", overrideBasis: "",
    transactionCostPct: "", transactionCostFlat: "",
    proceedsAccountId: "", qualifiesForHomeSaleExclusion: false,
  };
}
export function emptyBuyLeg(key: string): BuyLegDraft {
  return {
    key, kind: "buy", name: "", assetName: "",
    assetCategory: "real_estate", assetSubType: SUB_TYPE_BY_CATEGORY["real_estate"][0],
    purchasePrice: "", growthRate: "", basis: "", fundingAccountId: "",
    showMortgage: false, mortgageAmount: "", mortgageRate: "", mortgageTermMonths: "360",
  };
}

// Re-exported so the engine Account.category and our AssetCategory stay aligned.
export type EngineAssetCategory = Account["category"];
