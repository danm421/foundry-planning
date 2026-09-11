import { describe, it, expect } from "vitest";
import { postBodySchema, putBodySchema, resolvePropertyTaxUpdateFields } from "../route";

const buy = {
  type: "buy" as const,
  name: "Buy House",
  year: 2032,
  assetName: "New House",
  assetCategory: "real_estate" as const,
  assetSubType: "primary_residence" as const,
  purchasePrice: 1_500_000,
};

describe("asset-transaction property tax validation", () => {
  it("accepts a property tax on a buy", () => {
    const parsed = postBodySchema.parse({
      ...buy,
      annualPropertyTax: 16_500,
      propertyTaxGrowthRate: 0.03,
      propertyTaxGrowthSource: "custom",
    });
    expect(parsed.annualPropertyTax).toBe(16_500);
    expect(parsed.propertyTaxGrowthSource).toBe("custom");
  });

  it("accepts a buy with no property tax", () => {
    expect(postBodySchema.parse(buy).annualPropertyTax).toBeUndefined();
  });

  it("rejects a property tax on a sell", () => {
    const res = postBodySchema.safeParse({
      type: "sell", name: "Sell House", year: 2032,
      accountId: "11111111-1111-4111-8111-111111111111",
      annualPropertyTax: 16_500,
    });
    expect(res.success).toBe(false);
  });

  it("rejects a negative amount", () => {
    expect(postBodySchema.safeParse({ ...buy, annualPropertyTax: -1 }).success).toBe(false);
  });

  // -1 is the one value .min(-1) admitted that the engine cannot survive: the
  // deflation step divides by (1 + rate)^n = 0, giving Infinity, and the
  // re-inflation multiplies that by 0, giving NaN — which then propagates
  // through the whole cash flow. The percent input accepts a leading minus, so
  // it is reachable.
  it("rejects a growth rate of exactly -1 but keeps the rest of the range", () => {
    expect(postBodySchema.safeParse({ ...buy, propertyTaxGrowthRate: -1 }).success).toBe(false);
    expect(postBodySchema.safeParse({ ...buy, propertyTaxGrowthRate: -0.99 }).success).toBe(true);
    expect(postBodySchema.safeParse({ ...buy, propertyTaxGrowthRate: 1 }).success).toBe(true);
    const transactionId = "22222222-2222-4222-8222-222222222222";
    expect(
      putBodySchema.safeParse({ ...buy, transactionId, propertyTaxGrowthRate: -1 }).success,
    ).toBe(false);
  });

  it("rejects an unknown growth source", () => {
    expect(postBodySchema.safeParse({ ...buy, propertyTaxGrowthSource: "cpi" }).success).toBe(false);
  });

  it("applies the same rules on edit", () => {
    // putBodySchema requires transactionId (it's the PATCH row identifier);
    // the brief's snippet omitted it, which fails both assertions for the
    // wrong reason (a missing required field, not the property-tax rule
    // under test) — added here so the assertions test what they claim to.
    const transactionId = "22222222-2222-4222-8222-222222222222";
    expect(putBodySchema.safeParse({ ...buy, transactionId, annualPropertyTax: 16_500 }).success).toBe(true);
    expect(
      putBodySchema.safeParse({
        transactionId,
        type: "sell", name: "Sell", year: 2032,
        accountId: "11111111-1111-4111-8111-111111111111",
        propertyTaxGrowthSource: "custom",
      }).success,
    ).toBe(false);
  });
});

// C2: the PATCH superRefine only inspects the incoming body, so flipping an
// existing buy to a sell without resending the property-tax fields would
// otherwise leave stale values in the .set() and let the DB CHECK
// (asset_transactions_buy_only_property_tax_check) fail as a raw Postgres
// error. resolvePropertyTaxUpdateFields is the pure piece of that decision —
// it computes against the RESULTING type, not just the incoming body — and is
// exercised here without a fake DB.
describe("resolvePropertyTaxUpdateFields", () => {
  it("nulls all three columns when the resulting type is sell, even with no incoming fields", () => {
    // Simulates a PATCH { type: "sell" } against an existing buy row that
    // already has property tax set: nothing in the incoming body mentions
    // these fields (all undefined), but the CHECK still must be satisfied.
    expect(resolvePropertyTaxUpdateFields("sell", undefined, undefined, undefined)).toEqual({
      annualPropertyTax: null,
      propertyTaxGrowthRate: null,
      propertyTaxGrowthSource: null,
    });
  });

  it("nulls all three columns on sell even if the body (illegally) sent values", () => {
    expect(resolvePropertyTaxUpdateFields("sell", 16_500, 0.03, "custom")).toEqual({
      annualPropertyTax: null,
      propertyTaxGrowthRate: null,
      propertyTaxGrowthSource: null,
    });
  });

  it("passes through provided fields unchanged when the resulting type is buy", () => {
    expect(resolvePropertyTaxUpdateFields("buy", 16_500, 0.03, "custom")).toEqual({
      annualPropertyTax: "16500",
      propertyTaxGrowthRate: "0.03",
      propertyTaxGrowthSource: "custom",
    });
  });

  it("omits fields the caller didn't touch when the resulting type is buy", () => {
    expect(resolvePropertyTaxUpdateFields("buy", undefined, undefined, undefined)).toEqual({});
  });

  it("passes an explicit null through on buy (clearing one field without touching type)", () => {
    expect(resolvePropertyTaxUpdateFields("buy", null, undefined, undefined)).toEqual({
      annualPropertyTax: null,
    });
  });
});
