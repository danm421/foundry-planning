import { describe, it, expect } from "vitest";
import { blendRealization } from "../realization-mix";

const stocks = { id: "stocks", pctOrdinaryIncome: 0, pctQualifiedDividends: 0.2, pctLtCapitalGains: 0.8, pctTaxExempt: 0 };
const munis = { id: "munis", pctOrdinaryIncome: 0, pctQualifiedDividends: 0, pctLtCapitalGains: 0.1, pctTaxExempt: 0.9 };

describe("blendRealization", () => {
  it("weights each asset class's split by its share of the allocation", () => {
    const mix = blendRealization(
      [
        { assetClassId: "stocks", weight: 0.6 },
        { assetClassId: "munis", weight: 0.4 },
      ],
      [stocks, munis],
    );
    expect(mix.pctQualifiedDividends).toBeCloseTo(0.12, 10);
    expect(mix.pctLtCapitalGains).toBeCloseTo(0.52, 10);
    expect(mix.pctTaxExempt).toBeCloseTo(0.36, 10);
    expect(mix.pctOrdinaryIncome).toBe(0);
  });

  it("realizes nothing on weight it cannot classify", () => {
    const mix = blendRealization([{ assetClassId: "unknown", weight: 1 }], [stocks]);
    expect(mix).toEqual({ pctOrdinaryIncome: 0, pctQualifiedDividends: 0, pctLtCapitalGains: 0, pctTaxExempt: 0 });
  });
});
