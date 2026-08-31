import { describe, it, expect } from "vitest";
import { money } from "../reconcile-compensation";

describe("money", () => {
  it("rounds to whole dollars with comma grouping", () => {
    expect(money(239_549.96, "biweekly × 26", ["f1"]).display).toBe("$239,550");
  });

  it("keeps the unrounded amount alongside the display string", () => {
    const m = money(239_549.96, "biweekly × 26", ["f1"]);
    expect(m.amount).toBe(239_549.96);
  });

  it("formats a whole number without a decimal tail", () => {
    expect(money(26_000, "per period × 26", ["f1"]).display).toBe("$26,000");
  });

  it("carries basis and source files through", () => {
    const m = money(1000, "YTD, not annualized", ["f1", "f2"]);
    expect(m.basis).toBe("YTD, not annualized");
    expect(m.fromFiles).toEqual(["f1", "f2"]);
  });

  it("formats zero and negative amounts", () => {
    expect(money(0, "b", []).display).toBe("$0");
    expect(money(-1234.5, "b", []).display).toBe("-$1,235");
  });
});
