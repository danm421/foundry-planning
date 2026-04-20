import { describe, it, expect } from "vitest";
import { resolveInflationRate } from "../inflation";

describe("resolveInflationRate", () => {
  it("returns the stored plan inflation rate when source is 'custom'", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "custom", inflationRate: "0.025" },
      { geometricReturn: "0.03" }, // present but ignored
      null,
    );
    expect(rate).toBeCloseTo(0.025);
  });

  it("returns the Inflation asset class's geometricReturn when source is 'asset_class'", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "asset_class", inflationRate: "0.025" }, // ignored
      { geometricReturn: "0.032" },
      null,
    );
    expect(rate).toBeCloseTo(0.032);
  });

  it("prefers a client-level override when source is 'asset_class' and an override is present", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "asset_class", inflationRate: "0.025" },
      { geometricReturn: "0.032" },
      { geometricReturn: "0.035" },
    );
    expect(rate).toBeCloseTo(0.035);
  });

  it("returns 0 when source is 'asset_class' and no AC is configured", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "asset_class", inflationRate: "0.025" },
      null,
      null,
    );
    expect(rate).toBe(0);
  });

  it("returns 0 when source is 'custom' and the stored rate is null", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "custom", inflationRate: null },
      { geometricReturn: "0.03" },
      null,
    );
    expect(rate).toBe(0);
  });

  it("accepts numeric inputs directly (not just drizzle decimal strings)", () => {
    const rate = resolveInflationRate(
      { inflationRateSource: "custom", inflationRate: 0.041 },
      null,
      null,
    );
    expect(rate).toBeCloseTo(0.041);
  });
});
