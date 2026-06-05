import { describe, it, expect } from "vitest";
import { resolveStrategy } from "../strategy";
import type { EquityStrategy } from "../types";

const account: EquityStrategy = {
  exerciseTiming: "at_vest", exerciseYear: null,
  sellTiming: "hold", sellYear: null, sellPercentPerYear: null, sellStartYear: null,
};

describe("resolveStrategy", () => {
  it("falls back to the account default when grant + tranche are empty", () => {
    const r = resolveStrategy(account, null, null);
    expect(r.exerciseTiming).toBe("at_vest");
    expect(r.sellTiming).toBe("hold");
  });

  it("grant overrides account per-field; unset grant fields inherit", () => {
    const r = resolveStrategy(account, { sellTiming: "immediately" }, null);
    expect(r.exerciseTiming).toBe("at_vest");   // inherited
    expect(r.sellTiming).toBe("immediately");   // overridden
  });

  it("tranche is most specific and wins over grant + account", () => {
    const r = resolveStrategy(
      account,
      { sellTiming: "immediately" },
      { sellTiming: "percent_per_year", sellPercentPerYear: 0.25, sellStartYear: 2028 },
    );
    expect(r.sellTiming).toBe("percent_per_year");
    expect(r.sellPercentPerYear).toBe(0.25);
    expect(r.sellStartYear).toBe(2028);
    expect(r.exerciseTiming).toBe("at_vest");   // still inherited from account
  });
});
