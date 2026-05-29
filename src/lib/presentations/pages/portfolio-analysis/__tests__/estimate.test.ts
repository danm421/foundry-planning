import { describe, it, expect } from "vitest";
import { estimatePortfolioAnalysisPageCount } from "../estimate-page-count";

describe("estimatePortfolioAnalysisPageCount", () => {
  it("returns a fixed page count without reading data (called with undefined at estimate time)", () => {
    expect(estimatePortfolioAnalysisPageCount()).toBe(2);
  });
});
