import { describe, it, expect, vi } from "vitest";
import {
  refreshReferencedPriceHistory,
  type ReferencedSecurity,
  type RefreshDeps,
} from "../refresh-price-history";
import type { MonthlyBar } from "@/lib/cma-stats";

const NOW = new Date("2026-08-17T00:00:00Z"); // prior closed month = 2026-07

function bars(start: string, n: number): MonthlyBar[] {
  const [y0, m0] = start.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y0, m0 - 1 + i, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return { date: `${key}-01`, adjClose: 100 + i };
  });
}

const sec = (over: Partial<ReferencedSecurity> = {}): ReferencedSecurity => ({
  id: "sec-1",
  identifier: "VTI",
  identifierType: "ticker",
  lastBar: null,
  ...over,
});

function harness(
  securities: ReferencedSecurity[],
  fetchImpl: (symbol: string) => Promise<MonthlyBar[]>,
  over: Partial<RefreshDeps> = {},
) {
  const writes: { id: string; bars: MonthlyBar[] }[] = [];
  const deps: RefreshDeps = {
    listReferenced: async () => securities,
    fetchBars: fetchImpl,
    toSymbol: (t) => `${t}.US`,
    writeBars: async (id, b) => {
      writes.push({ id, bars: b });
    },
    now: NOW,
    ...over,
  };
  return { deps, writes };
}

describe("refreshReferencedPriceHistory", () => {
  it("writes a good series and counts only the bars past the stored high-water mark", async () => {
    // Stored through 2026-04; fetch returns through 2026-07 → 3 new bars.
    const { deps, writes } = harness([sec({ lastBar: "2026-04" })], async () =>
      bars("2000-01", 319),
    );
    const s = await refreshReferencedPriceHistory(deps);

    expect(s.written).toBe(1);
    expect(s.barsWritten).toBe(3);
    // The full series is still handed to the writer — the conflict clause
    // dedupes; only the REPORTED count is narrowed.
    expect(writes[0].bars).toHaveLength(319);
  });

  it("skips a security that already carries the latest closed month without fetching", async () => {
    const fetchBars = vi.fn(async () => bars("2000-01", 319));
    const { deps } = harness([sec({ lastBar: "2026-07" })], fetchBars);
    const s = await refreshReferencedPriceHistory(deps);

    expect(s.fresh).toBe(1);
    expect(fetchBars).not.toHaveBeenCalled();
    expect(s.written).toBe(0);
  });

  it("refuses a stale series rather than truncating every co-held portfolio", async () => {
    const { deps, writes } = harness([sec({ identifier: "ENN" })], async () =>
      bars("1999-01", 106),
    ); // ends 2007-10
    const s = await refreshReferencedPriceHistory(deps);

    expect(writes).toHaveLength(0);
    expect(s.written).toBe(0);
    expect(s.skipped).toHaveLength(1);
    expect(s.skipped[0].stale).toBe(true);
  });

  it("refuses a series too short to survive the shared window", async () => {
    const { deps, writes } = harness([sec({ identifier: "SPAXX" })], async () =>
      bars("2026-02", 6),
    );
    const s = await refreshReferencedPriceHistory(deps);
    expect(writes).toHaveLength(0);
    expect(s.skipped[0].reason).toMatch(/monthly returns/);
  });

  it("records a fetch failure without aborting the rest of the run", async () => {
    const { deps } = harness(
      [sec({ id: "a", identifier: "BAD" }), sec({ id: "b", identifier: "VTI" })],
      async (symbol) => {
        if (symbol === "BAD.US") throw new Error("HTTP 500");
        return bars("2000-01", 319);
      },
    );
    const s = await refreshReferencedPriceHistory(deps);

    expect(s.failed).toEqual([{ ticker: "BAD", error: "HTTP 500" }]);
    expect(s.written).toBe(1); // VTI still processed
  });

  it("does not try to price a CUSIP-identified security", async () => {
    const fetchBars = vi.fn(async () => bars("2000-01", 319));
    const { deps } = harness(
      [sec({ identifier: "922908769", identifierType: "cusip" })],
      fetchBars,
    );
    const s = await refreshReferencedPriceHistory(deps);

    expect(fetchBars).not.toHaveBeenCalled();
    expect(s.skipped[0].reason).toBe("not ticker-identified");
  });

  it("stops at the fetch limit and says so", async () => {
    const fetchBars = vi.fn(async () => bars("2000-01", 319));
    const { deps } = harness(
      [sec({ id: "a" }), sec({ id: "b" }), sec({ id: "c" })],
      fetchBars,
      { limit: 2 },
    );
    const s = await refreshReferencedPriceHistory(deps);

    expect(fetchBars).toHaveBeenCalledTimes(2);
    expect(s.truncated).toBe(true);
  });

  it("counts a fetched-but-unchanged series as neither written nor fresh", async () => {
    // lastBar 2026-06 is behind prior (2026-07) so it fetches, but the feed has
    // nothing newer — a live security running a month late.
    const { deps } = harness([sec({ identifier: "SEM", lastBar: "2026-06" })], async () =>
      bars("2009-10", 201),
    ); // ends 2026-06
    const s = await refreshReferencedPriceHistory(deps);

    expect(s.written).toBe(0);
    expect(s.barsWritten).toBe(0);
    expect(s.skipped).toHaveLength(0); // 1 month behind is within tolerance
    expect(s.fresh).toBe(0);
  });
});
