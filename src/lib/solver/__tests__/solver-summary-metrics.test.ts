import { describe, it, expect } from "vitest";
import { yearsFullyFunded, lifetimeTaxes } from "../solver-summary-metrics";
import type { ProjectionYear } from "@/engine/types";

// liquidPortfolioTotal (from @/engine/monteCarlo/trial) reads
// portfolioAssets.taxableTotal + cashTotal + retirementTotal.
// Supply that shape; put all liquid value in taxableTotal for simplicity.
const y = (liquidTotal: number, taxes: number) =>
  ({
    portfolioAssets: { taxableTotal: liquidTotal, cashTotal: 0, retirementTotal: 0 },
    expenses: { taxes },
  }) as unknown as ProjectionYear;

describe("solver summary metrics", () => {
  it("counts years with non-negative liquid portfolio", () => {
    expect(yearsFullyFunded([y(100, 0), y(0, 0), y(-5, 0)])).toBe(2);
  });
  it("sums per-year taxes", () => {
    expect(lifetimeTaxes([y(0, 1000), y(0, 2500), y(0, 0)])).toBe(3500);
  });
});
