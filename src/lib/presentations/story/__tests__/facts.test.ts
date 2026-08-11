import { describe, it, expect } from "vitest";
import { moneyFact, pctFact, yearFact, factDisplaySet } from "../facts";

describe("story facts", () => {
  it("formats money compactly and never shows cents", () => {
    expect(moneyFact("a", "A", 1_234_567).display).toBe("$1.2M");
    expect(moneyFact("b", "B", 45_600).display).toBe("$46K");
    expect(moneyFact("c", "C", 812).display).toBe("$812");
  });

  it("formats a rate as a percentage with at most one decimal", () => {
    expect(pctFact("d", "D", 0.91).display).toBe("91%");
    expect(pctFact("e", "E", 0.735).display).toBe("73.5%");
  });

  it("formats a year as four bare digits", () => {
    expect(yearFact("f", "F", 2041).display).toBe("2041");
  });

  it("keeps the raw value alongside the display string", () => {
    const f = moneyFact("g", "Liquid assets", 2_100_000);
    expect(f).toEqual({ id: "g", label: "Liquid assets", display: "$2.1M", raw: 2_100_000 });
  });

  it("collects every display string into a lookup set", () => {
    const set = factDisplaySet([moneyFact("a", "A", 1_234_567), pctFact("b", "B", 0.91)]);
    expect(set.has("$1.2M")).toBe(true);
    expect(set.has("91%")).toBe(true);
    expect(set.has("$9.9M")).toBe(false);
  });
});
