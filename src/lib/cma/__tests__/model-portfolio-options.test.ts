import { describe, it, expect } from "vitest";
import { buildModelPortfolioOptions } from "../model-portfolio-options";

describe("buildModelPortfolioOptions", () => {
  it("weights each asset class's geometric return by its allocation", () => {
    const opts = buildModelPortfolioOptions(
      [{ id: "p1", name: "60/40" }],
      [
        { modelPortfolioId: "p1", assetClassId: "eq", weight: "0.6" },
        { modelPortfolioId: "p1", assetClassId: "bond", weight: "0.4" },
      ],
      [
        { id: "eq", geometricReturn: "0.08" },
        { id: "bond", geometricReturn: "0.03" },
      ],
    );
    expect(opts).toHaveLength(1);
    expect(opts[0].id).toBe("p1");
    expect(opts[0].name).toBe("60/40");
    expect(opts[0].blendedReturn).toBeCloseTo(0.6 * 0.08 + 0.4 * 0.03, 10);
  });

  it("ignores allocations whose asset class is missing, and returns 0 for unallocated portfolios", () => {
    const opts = buildModelPortfolioOptions(
      [{ id: "p1", name: "A" }, { id: "p2", name: "B" }],
      [{ modelPortfolioId: "p1", assetClassId: "ghost", weight: "1" }],
      [{ id: "eq", geometricReturn: "0.08" }],
    );
    expect(opts.find((o) => o.id === "p1")!.blendedReturn).toBe(0);
    expect(opts.find((o) => o.id === "p2")!.blendedReturn).toBe(0);
  });
});
