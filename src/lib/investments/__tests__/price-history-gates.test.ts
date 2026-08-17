import { describe, it, expect } from "vitest";
import {
  assessPriceSeries,
  MIN_RETURNS,
  MIN_DENSITY,
  MAX_STALE_MONTHS,
} from "../price-history-gates";
import type { MonthlyBar } from "@/lib/cma-stats";

/** Contiguous monthly bars starting at `start`, `n` of them. */
function bars(start: string, n: number, opts: { skip?: number[] } = {}): MonthlyBar[] {
  const [y0, m0] = start.split("-").map(Number);
  const out: MonthlyBar[] = [];
  for (let i = 0; i < n; i++) {
    if (opts.skip?.includes(i)) continue;
    const d = new Date(Date.UTC(y0, m0 - 1 + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    out.push({ date: `${key}-01`, adjClose: 100 + i });
  }
  return out;
}

const PRIOR = "2026-07";

describe("assessPriceSeries", () => {
  it("accepts a long, dense, current series", () => {
    // 2000-01 .. 2026-07 inclusive
    const v = assessPriceSeries(bars("2000-01", 319), PRIOR);
    expect(v.ok).toBe(true);
  });

  it("rejects a series with too few returns to survive the shared window", () => {
    const v = assessPriceSeries(bars("2024-01", MIN_RETURNS), PRIOR); // MIN_RETURNS bars → MIN_RETURNS-1 returns
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toMatch(/monthly returns/);
      expect(v.stale).toBeFalsy();
    }
  });

  it("rejects a gappy series — non-adjacent months would be paired as one move", () => {
    // 200 months of span, but a third of them missing.
    const skip = Array.from({ length: 70 }, (_, i) => i * 2 + 1);
    const v = assessPriceSeries(bars("2010-01", 200, { skip }), PRIOR);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/gappy/);
  });

  it("rejects a series that stops years ago, and marks it stale", () => {
    const v = assessPriceSeries(bars("1999-01", 106), PRIOR); // ends 2007-10, like ENN
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.stale).toBe(true);
      expect(v.reason).toMatch(/stale/);
    }
  });

  it("tolerates ordinary feed lag up to MAX_STALE_MONTHS", () => {
    // Ends exactly MAX_STALE_MONTHS behind the prior closed month.
    const v = assessPriceSeries(bars("2000-01", 316), PRIOR); // ends 2026-04 → 3 months behind
    expect(v.ok).toBe(true);
  });

  it("rejects one month past the tolerance", () => {
    const v = assessPriceSeries(bars("2000-01", 315), PRIOR); // ends 2026-03 → 4 months behind
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.stale).toBe(true);
  });

  it("accepts a series carrying the partial current month", () => {
    // EODHD returns an in-progress bar for the current month; that is ahead of
    // `prior`, not behind, and must not read as negative staleness failing a gate.
    const v = assessPriceSeries(bars("2000-01", 320), PRIOR); // ends 2026-08
    expect(v.ok).toBe(true);
  });

  it("rejects an empty series without throwing", () => {
    const v = assessPriceSeries([], PRIOR);
    expect(v.ok).toBe(false);
  });

  it("exposes the thresholds it enforces", () => {
    expect(MIN_RETURNS).toBe(36);
    expect(MIN_DENSITY).toBe(0.95);
    expect(MAX_STALE_MONTHS).toBe(3);
  });
});
