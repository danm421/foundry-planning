// src/lib/portal/__tests__/networth-trend.test.ts
import { describe, it, expect } from "vitest";
import {
  reconstructDailyNetWorth,
  sliceSeriesToWindow,
} from "@/lib/portal/networth-trend";

describe("reconstructDailyNetWorth", () => {
  it("holds flat when there are no transactions (illiquid baseline)", () => {
    const s = reconstructDailyNetWorth({
      netWorthNow: 1000, asOfDate: "2026-06-03", startDate: "2026-06-01", transactions: [],
    });
    expect(s).toEqual([
      { date: "2026-06-01", netWorth: 1000 },
      { date: "2026-06-02", netWorth: 1000 },
      { date: "2026-06-03", netWorth: 1000 },
    ]);
  });

  it("walks back a cash spend: before the spend net worth was higher", () => {
    // amount +200 on 06-03 = money out → net worth was 200 higher before it
    const s = reconstructDailyNetWorth({
      netWorthNow: 1000, asOfDate: "2026-06-03", startDate: "2026-06-02",
      transactions: [{ date: "2026-06-03", amount: 200 }],
    });
    expect(s).toEqual([
      { date: "2026-06-02", netWorth: 1200 },
      { date: "2026-06-03", netWorth: 1000 },
    ]);
  });

  it("walks back a deposit: before the deposit net worth was lower", () => {
    const s = reconstructDailyNetWorth({
      netWorthNow: 1000, asOfDate: "2026-06-02", startDate: "2026-06-01",
      transactions: [{ date: "2026-06-02", amount: -500 }],
    });
    expect(s).toEqual([
      { date: "2026-06-01", netWorth: 500 },
      { date: "2026-06-02", netWorth: 1000 },
    ]);
  });

  it("treats a credit-card charge the same as a cash spend (both add back)", () => {
    // a +300 charge on a tracked credit liability raised debt → net worth was 300 higher before
    const s = reconstructDailyNetWorth({
      netWorthNow: 0, asOfDate: "2026-06-02", startDate: "2026-06-01",
      transactions: [{ date: "2026-06-02", amount: 300 }],
    });
    expect(s[0]).toEqual({ date: "2026-06-01", netWorth: 300 });
    expect(s[1]).toEqual({ date: "2026-06-02", netWorth: 0 });
  });

  it("aggregates multiple transactions on the same day", () => {
    const s = reconstructDailyNetWorth({
      netWorthNow: 100, asOfDate: "2026-06-02", startDate: "2026-06-01",
      transactions: [
        { date: "2026-06-02", amount: 40 },
        { date: "2026-06-02", amount: 10 },
      ],
    });
    expect(s[0].netWorth).toBe(150);
  });

  it("ignores transactions dated after asOfDate", () => {
    const s = reconstructDailyNetWorth({
      netWorthNow: 100, asOfDate: "2026-06-02", startDate: "2026-06-01",
      transactions: [{ date: "2026-06-09", amount: 999 }],
    });
    expect(s.every((p) => p.netWorth === 100)).toBe(true);
  });
});

describe("sliceSeriesToWindow", () => {
  const series = [
    { date: "2025-06-22", netWorth: 1 },
    { date: "2026-01-01", netWorth: 2 },
    { date: "2026-06-01", netWorth: 3 },
    { date: "2026-06-21", netWorth: 4 },
    { date: "2026-06-22", netWorth: 5 },
  ];
  it("ALL returns everything", () => {
    expect(sliceSeriesToWindow(series, "ALL", "2026-06-22")).toHaveLength(5);
  });
  it("1W keeps only the last 7 days", () => {
    expect(sliceSeriesToWindow(series, "1W", "2026-06-22").map((p) => p.date)).toEqual([
      "2026-06-21", "2026-06-22",
    ]);
  });
  it("YTD keeps points on/after Jan 1 of asOf year", () => {
    expect(sliceSeriesToWindow(series, "YTD", "2026-06-22").map((p) => p.date)).toEqual([
      "2026-01-01", "2026-06-01", "2026-06-21", "2026-06-22",
    ]);
  });
});
