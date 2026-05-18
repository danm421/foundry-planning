import { describe, it, expect } from "vitest";
import { coerceAssetTransactionDraft } from "../technique-form-data";

describe("coerceAssetTransactionDraft", () => {
  it("coerces string numeric fields to numbers and drops nulls", () => {
    const out = coerceAssetTransactionDraft(
      {
        type: "buy",
        name: "Buy lake house",
        year: 2031,
        assetName: "Lake house",
        assetCategory: "real_estate",
        purchasePrice: "450000",
        growthRate: "0.03",
        basis: "450000",
        mortgageAmount: null,
        mortgageRate: null,
      },
      "at-1",
    );
    expect(out.id).toBe("at-1");
    expect(out.type).toBe("buy");
    expect(out.purchasePrice).toBe(450000);
    expect(out.growthRate).toBe(0.03);
    expect(out.basis).toBe(450000);
    expect(out).not.toHaveProperty("mortgageAmount");
  });
});
