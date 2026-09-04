import { describe, it, expect } from "vitest";
import { freeModelPortfolioName } from "@/lib/investments/derived-portfolio-name";

describe("freeModelPortfolioName", () => {
  it("keeps the fund's own name when nothing collides", () => {
    expect(freeModelPortfolioName("Global 40/60", ["Balanced", "Growth"])).toBe("Global 40/60");
  });

  it("suffixes when a model portfolio already owns the name", () => {
    expect(freeModelPortfolioName("Balanced", ["Balanced"])).toBe("Balanced (fund)");
  });

  it("counts up when the suffixed name is taken too", () => {
    expect(freeModelPortfolioName("Balanced", ["Balanced", "Balanced (fund)"])).toBe(
      "Balanced (fund 2)",
    );
  });

  it("compares case- and whitespace-insensitively — the DB constraint is not the only judge of confusing", () => {
    expect(freeModelPortfolioName("Balanced", ["  balanced  "])).toBe("Balanced (fund)");
  });

  it("handles an empty firm", () => {
    expect(freeModelPortfolioName("Balanced", [])).toBe("Balanced");
  });
});
