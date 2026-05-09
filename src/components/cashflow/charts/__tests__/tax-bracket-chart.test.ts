import { describe, it, expect } from "vitest";
import { buildTaxBracketSeries } from "../tax-bracket-chart";
import { makeYear } from "./fixtures";

describe("buildTaxBracketSeries", () => {
  it("returns zero rates when taxResult is absent", () => {
    const years = [makeYear({ year: 2026 }), makeYear({ year: 2027 })];
    const result = buildTaxBracketSeries(years);
    expect(result.effective.length).toBe(2);
    expect(result.marginal.length).toBe(2);
    for (const v of result.effective) expect(v).toBe(0);
    for (const v of result.marginal) expect(v).toBe(0);
  });

  it("returns effective rate and marginal rate per year", () => {
    const years = [
      makeYear({
        year: 2026,
        taxResult: {
          diag: { effectiveFederalRate: 0.18, marginalFederalRate: 0.22 },
        } as any,
      }),
      makeYear({
        year: 2027,
        taxResult: {
          diag: { effectiveFederalRate: 0.2, marginalFederalRate: 0.24 },
        } as any,
      }),
    ];
    const result = buildTaxBracketSeries(years);

    expect(result.effective.length).toBe(2);
    expect(result.marginal.length).toBe(2);

    expect(result.effective[0]).toBeCloseTo(0.18);
    expect(result.effective[1]).toBeCloseTo(0.2);
    expect(result.marginal[0]).toBeCloseTo(0.22);
    expect(result.marginal[1]).toBeCloseTo(0.24);

    for (const v of result.effective) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (const v of result.marginal) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
