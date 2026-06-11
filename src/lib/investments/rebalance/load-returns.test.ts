import { describe, it, expect } from "vitest";
import { barsToReturnsBySecurity } from "./load-inputs";

describe("barsToReturnsBySecurity", () => {
  it("groups price rows by security, sorts by month, and converts to returns", () => {
    const rows = [
      { securityId: "a", month: "2020-02", adjClose: 110 },
      { securityId: "a", month: "2020-01", adjClose: 100 },
      { securityId: "b", month: "2020-01", adjClose: 50 },
      { securityId: "b", month: "2020-02", adjClose: 55 },
    ];
    const out = barsToReturnsBySecurity(rows);
    expect(out.get("a")).toHaveLength(1);
    expect(out.get("a")![0].date).toBe("2020-02");
    expect(out.get("a")![0].r).toBeCloseTo(0.1, 10);
    expect(out.get("b")![0].r).toBeCloseTo(0.1, 10);
  });
});
