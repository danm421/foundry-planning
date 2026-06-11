import { describe, it, expect } from "vitest";
import { toGrowthSource } from "@/lib/investments/allocation";

describe("toGrowthSource", () => {
  it("passes ticker_portfolio through toGrowthSource", () => {
    expect(toGrowthSource("ticker_portfolio")).toBe("ticker_portfolio");
  });
});
