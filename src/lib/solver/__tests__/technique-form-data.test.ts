import { describe, it, expect } from "vitest";
import {
  coerceAssetTransactionDraft,
  toRothConversionInitialData,
  toAssetTransactionInitialData,
} from "../technique-form-data";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import type { AssetTransaction } from "@/engine/types";

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

  it("coerces the property tax numerics off the form's strings", () => {
    const out = coerceAssetTransactionDraft(
      {
        type: "buy", name: "Buy House", year: 2032,
        annualPropertyTax: "16500",
        propertyTaxGrowthRate: "0.03",
        propertyTaxGrowthSource: "custom",
      },
      "buy-1",
    );
    expect(out.annualPropertyTax).toBe(16_500);
    expect(out.propertyTaxGrowthRate).toBe(0.03);
    expect(out.propertyTaxGrowthSource).toBe("custom");
  });
});

describe("buy leg property tax", () => {
  it("carries the property tax back into the form's initial data", () => {
    const initial = toAssetTransactionInitialData({
      id: "buy-1", name: "Buy House", type: "buy", year: 2032,
      annualPropertyTax: 16_500, propertyTaxGrowthRate: 0.03,
      propertyTaxGrowthSource: "custom",
    } as AssetTransaction);
    expect(initial.annualPropertyTax).toBe("16500");
    expect(initial.propertyTaxGrowthSource).toBe("custom");
  });

  it("the mutation schema does not strip the property tax", () => {
    const parsed = SOLVER_MUTATION_SCHEMA.parse({
      kind: "asset-transaction-upsert",
      id: "buy-1",
      value: {
        id: "buy-1", name: "Buy House", type: "buy", year: 2032,
        annualPropertyTax: 16_500, propertyTaxGrowthRate: 0.03,
        propertyTaxGrowthSource: "custom",
      },
    });
    // @ts-expect-error — passthrough keys are not on the inferred type
    expect(parsed.value.annualPropertyTax).toBe(16_500);
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
