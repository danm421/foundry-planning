import { describe, it, expect } from "vitest";
import { coerceAssetTransactionDraft, toRothConversionInitialData } from "../technique-form-data";

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

describe("toRothConversionInitialData", () => {
  it("stringifies numeric fields the form expects as strings", () => {
    const out = toRothConversionInitialData({
      id: "rc-1",
      name: "Conv",
      destinationAccountId: "a",
      sourceAccountIds: ["b"],
      conversionType: "fixed_amount",
      fixedAmount: 25000,
      startYear: 2030,
      endYear: 2035,
      indexingRate: 0.02,
    });
    expect(out.fixedAmount).toBe("25000");
    expect(out.indexingRate).toBe("0.02");
    expect(out.fillUpBracket).toBeNull();
    expect(out.startYear).toBe(2030);
    expect(out.endYear).toBe(2035);
  });
});
