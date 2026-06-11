import { describe, it, expect, vi } from "vitest";
import { loadTickerMonthlyReturns } from "./ticker-history";
import type { MonthlyBar } from "./cma-stats";

const bars = (pairs: [string, number][]): MonthlyBar[] =>
  pairs.map(([date, adjClose]) => ({ date, adjClose }));

describe("loadTickerMonthlyReturns", () => {
  it("returns cached bars without calling EODHD when cache is fresh", async () => {
    const fetchHistory = vi.fn();
    const store = {
      readBars: vi.fn().mockResolvedValue(bars([["2020-01-01", 100], ["2020-02-01", 110]])),
      upsertBars: vi.fn(),
    };
    const out = await loadTickerMonthlyReturns("VTI", {
      asOfMonth: "2020-02",
      store,
      fetchHistory,
    });
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2020-02");
    expect(out[0].r).toBeCloseTo(0.1, 10); // 110/100 - 1
  });

  it("fetches + upserts when cache is empty", async () => {
    const fetchHistory = vi.fn().mockResolvedValue(bars([["2020-01-01", 100], ["2020-02-01", 121]]));
    const store = {
      readBars: vi.fn().mockResolvedValue([]),
      upsertBars: vi.fn().mockResolvedValue(undefined),
    };
    const out = await loadTickerMonthlyReturns("VTI", {
      asOfMonth: "2020-02",
      store,
      fetchHistory,
    });
    expect(fetchHistory).toHaveBeenCalledOnce();
    expect(store.upsertBars).toHaveBeenCalledOnce();
    const last = out.at(-1)!;
    expect(last.date).toBe("2020-02");
    expect(last.r).toBeCloseTo(0.21, 10); // 121/100 - 1
  });
});
