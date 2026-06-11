import { describe, it, expect } from "vitest";
import { alignToCommonWindow } from "./common-window";
import type { PortfolioHoldingSeries } from "@/lib/ticker-portfolio-service";

const s = (ticker: string, dates: string[]): PortfolioHoldingSeries => ({
  ticker,
  weight: 1,
  returns: dates.map((d) => ({ date: d, r: 0.01 })),
});

describe("alignToCommonWindow", () => {
  it("trims both sides to the dates present in every series", () => {
    const a = [s("A", ["2020-01", "2020-02", "2020-03"])];
    const b = [s("B", ["2020-02", "2020-03", "2020-04"])];

    const out = alignToCommonWindow(a, b);

    expect(out.windowStart).toBe("2020-02");
    expect(out.windowEnd).toBe("2020-03");
    expect(out.nMonths).toBe(2);
    expect(out.a[0].returns.map((x) => x.date)).toEqual(["2020-02", "2020-03"]);
    expect(out.b[0].returns.map((x) => x.date)).toEqual(["2020-02", "2020-03"]);
  });

  it("intersects across multiple series within a side", () => {
    const a = [s("A1", ["2020-01", "2020-02"]), s("A2", ["2020-02", "2020-03"])];
    const b = [s("B", ["2020-01", "2020-02", "2020-03"])];
    const out = alignToCommonWindow(a, b);
    expect(out.nMonths).toBe(1); // only 2020-02 is in all three series
    expect(out.windowStart).toBe("2020-02");
  });

  it("returns a null window when there is no overlap", () => {
    const out = alignToCommonWindow(
      [s("A", ["2019-01"])],
      [s("B", ["2020-01"])],
    );
    expect(out.windowStart).toBeNull();
    expect(out.nMonths).toBe(0);
  });
});
