import { describe, it, expect } from "vitest";
import { runProjection } from "../projection";
import { buildClientData, basePlanSettings, FIXTURE_TAX_PARAMS } from "./fixtures";
import type { AssetTransaction, ClientData } from "../types";

const BUY: AssetTransaction = {
  id: "buy-home",
  name: "Buy New House",
  type: "buy",
  year: 2032,
  assetName: "New House",
  assetCategory: "real_estate",
  assetSubType: "primary_residence",
  purchasePrice: 1_500_000,
  annualPropertyTax: 16_500,
  propertyTaxGrowthRate: 0.03,
  propertyTaxGrowthSource: "custom",
};

function data(transactions: AssetTransaction[]): ClientData {
  return buildClientData({
    assetTransactions: transactions,
    taxYearRows: FIXTURE_TAX_PARAMS,
    // `deductionBreakdown` is populated only inside the projection's
    // `useBracket` branch, so the SALT assertion below reads `undefined` on
    // both sides without this.
    planSettings: { ...basePlanSettings, taxEngineMode: "bracket" },
  });
}

/** Sum of every synthetic property-tax expense the projection emitted for the
 *  bought home in `year`. Synthetic ids are `synth-proptax-<accountId>` (plus a
 *  `-<entityId>` suffix per entity owner), and a buy's account id is
 *  `technique-acct-<transactionId>`. */
function propertyTaxCharged(years: ReturnType<typeof runProjection>, year: number): number {
  const row = years.find((y) => y.year === year);
  if (!row) throw new Error(`no projection row for ${year}`);
  const prefix = "synth-proptax-technique-acct-buy-home";
  return Object.entries(row.expenses.bySource)
    .filter(([id]) => id.startsWith(prefix))
    .reduce((sum, [, amt]) => sum + amt, 0);
}

describe("a purchased home's property tax", () => {
  it("charges nothing before the purchase year", () => {
    const years = runProjection(data([BUY]));
    expect(propertyTaxCharged(years, 2031)).toBe(0);
  });

  it("charges the entered amount in the purchase year", () => {
    const years = runProjection(data([BUY]));
    expect(propertyTaxCharged(years, 2032)).toBeCloseTo(16_500, 2);
  });

  it("grows the charge at the configured rate", () => {
    const years = runProjection(data([BUY]));
    expect(propertyTaxCharged(years, 2035)).toBeCloseTo(16_500 * Math.pow(1.03, 3), 2);
  });

  it("feeds the household SALT deduction", () => {
    const withTax = runProjection(data([BUY]));
    const without = runProjection(data([{ ...BUY, annualPropertyTax: undefined }]));
    const row = (ys: typeof withTax) => ys.find((y) => y.year === 2032)!;
    const delta =
      (row(withTax).deductionBreakdown?.belowLine.propertyTaxes ?? 0) -
      (row(without).deductionBreakdown?.belowLine.propertyTaxes ?? 0);
    expect(delta).toBeCloseTo(16_500, 2);
  });

  it("stops charging once the property is sold", () => {
    const sell: AssetTransaction = {
      id: "sell-home",
      name: "Sell New House",
      type: "sell",
      year: 2040,
      purchaseTransactionId: "buy-home",
    };
    const years = runProjection(data([BUY, sell]));
    expect(propertyTaxCharged(years, 2039)).toBeGreaterThan(0);
    expect(propertyTaxCharged(years, 2041)).toBe(0);
  });

  it("changes nothing when the field is null", () => {
    const before = runProjection(data([{ ...BUY, annualPropertyTax: undefined, propertyTaxGrowthRate: undefined }]));
    const bare = runProjection(data([{
      id: "buy-home", name: "Buy New House", type: "buy", year: 2032,
      assetName: "New House", assetCategory: "real_estate",
      assetSubType: "primary_residence", purchasePrice: 1_500_000,
    }]));
    expect(JSON.stringify(before)).toBe(JSON.stringify(bare));
  });

  it("charges nothing for a non-real-estate purchase carrying a stray value", () => {
    const years = runProjection(data([{ ...BUY, assetCategory: "taxable", assetSubType: "brokerage" }]));
    expect(propertyTaxCharged(years, 2032)).toBe(0);
  });
});
