export const ASSET_TYPE_IDS = [
  "equities",
  "taxable_bonds",
  "tax_exempt_bonds",
  "cash",
  "other",
] as const;

export type AssetTypeId = typeof ASSET_TYPE_IDS[number];

export const ASSET_TYPE_LABELS: Record<AssetTypeId, string> = {
  equities:         "Equities",
  taxable_bonds:    "Taxable Bonds",
  tax_exempt_bonds: "Tax-Exempt Bonds",
  cash:             "Cash",
  other:            "Other",
};

export const ASSET_TYPE_SORT_ORDER: Record<AssetTypeId, number> = {
  equities: 0,
  taxable_bonds: 1,
  tax_exempt_bonds: 2,
  cash: 3,
  other: 4,
};

export function isAssetTypeId(v: unknown): v is AssetTypeId {
  return typeof v === "string" && (ASSET_TYPE_IDS as readonly string[]).includes(v);
}
