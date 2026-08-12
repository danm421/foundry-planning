import { describe, it, expect } from "vitest";
import { buildBacktestSeries, buildStressWindows, STRESS_WINDOWS } from "../backtest";
import type { AlignedWindows } from "@/lib/investments/rebalance/common-window";

/** Monthly series of constant return `r` covering [startYm, endYm] inclusive. */
function months(startYm: string, endYm: string, r: number) {
  const out: { date: string; r: number }[] = [];
  let [y, m] = startYm.split("-").map(Number);
  const [ey, em] = endYm.split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push({ date: `${y}-${String(m).padStart(2, "0")}-01`, r });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

function aligned(startYm: string, endYm: string, rA: number, rB: number): AlignedWindows {
  const a = months(startYm, endYm, rA);
  const b = months(startYm, endYm, rB);
  return {
    a: [{ ticker: "A", weight: 1, returns: a }],
    b: [{ ticker: "B", weight: 1, returns: b }],
    windowStart: a[0].date,
    windowEnd: a[a.length - 1].date,
    nMonths: a.length,
  };
}

describe("buildBacktestSeries", () => {
  it("compounds from the start value", () => {
    const r = buildBacktestSeries(aligned("2015-01", "2020-12", 0.01, 0.005), 100_000)!;
    expect(r.startValue).toBe(100_000);
    expect(r.current).toHaveLength(73); // 72 months + the opening point
    expect(r.endingCurrent).toBeCloseTo(100_000 * 1.01 ** 72, 2);
    expect(r.endingProposed).toBeCloseTo(100_000 * 1.005 ** 72, 2);
  });

  it("opens both lines at the start value", () => {
    const r = buildBacktestSeries(aligned("2015-01", "2020-12", 0.01, 0.005), 100_000)!;
    expect(r.current[0].value).toBe(100_000);
    expect(r.proposed[0].value).toBe(100_000);
  });

  it("returns null below the minimum window rather than drawing a short line", () => {
    expect(buildBacktestSeries(aligned("2020-01", "2021-06", 0.01, 0.005), 100_000)).toBeNull();
  });
});

describe("buildStressWindows", () => {
  it("names three windows", () => {
    expect(STRESS_WINDOWS.map((w) => w.key)).toEqual(["gfc", "covid", "rates2022"]);
  });

  it("computes cumulative return, drawdown and dollars for a covered window", () => {
    const r = buildStressWindows(aligned("2005-01", "2023-12", -0.01, -0.005), 1_000_000);
    const covid = r.find((w) => w.key === "covid")!;
    expect(covid.available).toBe(true);
    // 2020-01..2020-03 is three months at -1%.
    expect(covid.currentReturn).toBeCloseTo(0.99 ** 3 - 1, 10);
    expect(covid.currentDrawdown).toBeCloseTo(1 - 0.99 ** 3, 10);
    expect(covid.currentDollars).toBeCloseTo(1_000_000 * (0.99 ** 3 - 1), 4);
    expect(covid.proposedReturn!).toBeGreaterThan(covid.currentReturn!);
  });

  it("marks a window unavailable with a reason when history starts too late", () => {
    const r = buildStressWindows(aligned("2015-01", "2023-12", -0.01, -0.005), 1_000_000);
    const gfc = r.find((w) => w.key === "gfc")!;
    expect(gfc.available).toBe(false);
    expect(gfc.unavailableReason).toMatch(/launched after/i);
    expect(gfc.currentReturn).toBeNull();
  });

  it("marks a partially covered window unavailable rather than understating the loss", () => {
    // History begins mid-crisis: reporting only the tail would show a smaller
    // decline than actually occurred.
    const r = buildStressWindows(aligned("2008-06", "2023-12", -0.01, -0.005), 1_000_000);
    expect(r.find((w) => w.key === "gfc")!.available).toBe(false);
  });
});
