import { describe, it, expect } from "vitest";
import {
  ASSET_TYPE_IDS,
  ASSET_TYPE_LABELS,
  ASSET_TYPE_SORT_ORDER,
  isAssetTypeId,
  type AssetTypeId,
} from "../asset-types";

describe("asset-types", () => {
  it("exports exactly the five ids in canonical order", () => {
    expect(ASSET_TYPE_IDS).toEqual([
      "equities",
      "taxable_bonds",
      "tax_exempt_bonds",
      "cash",
      "other",
    ]);
  });

  it("has a label for every id", () => {
    for (const id of ASSET_TYPE_IDS) {
      expect(ASSET_TYPE_LABELS[id]).toBeTruthy();
    }
    expect(ASSET_TYPE_LABELS.equities).toBe("Equities");
    expect(ASSET_TYPE_LABELS.taxable_bonds).toBe("Taxable Bonds");
    expect(ASSET_TYPE_LABELS.tax_exempt_bonds).toBe("Tax-Exempt Bonds");
    expect(ASSET_TYPE_LABELS.cash).toBe("Cash");
    expect(ASSET_TYPE_LABELS.other).toBe("Other");
  });

  it("has a sort order for every id and orders canonically", () => {
    const sorted = [...ASSET_TYPE_IDS].sort(
      (a, b) => ASSET_TYPE_SORT_ORDER[a] - ASSET_TYPE_SORT_ORDER[b],
    );
    expect(sorted).toEqual([...ASSET_TYPE_IDS]);
  });

  it("isAssetTypeId accepts valid ids", () => {
    for (const id of ASSET_TYPE_IDS) {
      expect(isAssetTypeId(id)).toBe(true);
    }
  });

  it("isAssetTypeId rejects unknown values", () => {
    expect(isAssetTypeId("commodities")).toBe(false);
    expect(isAssetTypeId("")).toBe(false);
    expect(isAssetTypeId(null)).toBe(false);
    expect(isAssetTypeId(undefined)).toBe(false);
    expect(isAssetTypeId(42)).toBe(false);
    expect(isAssetTypeId({})).toBe(false);
  });

  it("AssetTypeId type is inhabited by every id (compile-time check)", () => {
    const x: AssetTypeId = "equities";
    expect(ASSET_TYPE_IDS).toContain(x);
  });
});
