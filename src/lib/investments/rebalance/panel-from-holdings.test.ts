import { describe, it, expect } from "vitest";
import { buildHoldingSeries, type HoldingForSeries } from "./panel-from-holdings";
import type { MonthlyReturn } from "@/lib/cma-stats";

const r = (vals: number[]): MonthlyReturn[] =>
  vals.map((v, i) => ({ date: `2020-${String(i + 1).padStart(2, "0")}`, r: v }));

describe("buildHoldingSeries", () => {
  it("weights covered securities by market value over the covered set", () => {
    const holdings: HoldingForSeries[] = [
      { securityId: "spy", ticker: "SPY", marketValue: 6000 },
      { securityId: "bnd", ticker: "BND", marketValue: 2000 },
      { securityId: null, ticker: "CASHX", marketValue: 2000 }, // unclassified → uncovered
    ];
    const returns = new Map<string, MonthlyReturn[]>([
      ["spy", r([0.01, 0.02])],
      ["bnd", r([0.0, 0.01])],
    ]);

    const out = buildHoldingSeries(holdings, returns);

    expect(out.totalValue).toBe(10000);
    expect(out.coveredValue).toBe(8000);
    expect(out.coveragePct).toBeCloseTo(0.8, 10);
    expect(out.uncoveredTickers).toEqual(["CASHX"]);
    const spy = out.series.find((s) => s.ticker === "SPY")!;
    expect(spy.weight).toBeCloseTo(0.75, 10); // 6000 / 8000
  });

  it("aggregates multiple holdings of the same security", () => {
    const holdings: HoldingForSeries[] = [
      { securityId: "spy", ticker: "SPY", marketValue: 3000 },
      { securityId: "spy", ticker: "SPY", marketValue: 1000 },
    ];
    const returns = new Map([["spy", r([0.01])]]);
    const out = buildHoldingSeries(holdings, returns);
    expect(out.series).toHaveLength(1);
    expect(out.series[0].weight).toBeCloseTo(1, 10);
  });

  it("returns empty series and 0 coverage when nothing is covered", () => {
    const out = buildHoldingSeries(
      [{ securityId: null, ticker: "X", marketValue: 500 }],
      new Map(),
    );
    expect(out.series).toEqual([]);
    expect(out.coveragePct).toBe(0);
  });
});
