import { describe, it, expect } from "vitest";
import { aggregateBookBreakdown, type BookQueryRow } from "../book-breakdown";

function row(p: Partial<BookQueryRow>): BookQueryRow {
  return {
    householdId: "h1",
    householdName: "Anderson",
    accountId: "a1",
    accountName: "Brokerage",
    category: "taxable",
    value: "1000.00",
    countsTowardAum: true,
    ...p,
  };
}

describe("aggregateBookBreakdown", () => {
  it("returns zeros and no households for empty input", () => {
    const r = aggregateBookBreakdown([]);
    expect(r.households).toEqual([]);
    expect(r.totals).toEqual({
      bookValue: 0,
      heldAway: 0,
      total: 0,
      heldAwayAccounts: 0,
      householdCount: 0,
    });
    expect(r.concentration).toEqual({
      top5BookSharePct: 0,
      largestHeldAway: null,
      heldAwayHouseholdCount: 0,
    });
  });

  it("groups accounts by household and splits managed vs held-away", () => {
    const r = aggregateBookBreakdown([
      row({ accountId: "a1", value: "200000.00", countsTowardAum: true }),
      row({ accountId: "a2", value: "50000.00", countsTowardAum: false }),
      row({ householdId: "h2", householdName: "Baxter", accountId: "a3", value: "90000.00", countsTowardAum: true }),
    ]);
    const anderson = r.households.find((h) => h.householdId === "h1")!;
    expect(anderson.bookValue).toBe(200000);
    expect(anderson.heldAway).toBe(50000);
    expect(anderson.total).toBe(250000);
    expect(anderson.accounts).toHaveLength(2);
    expect(r.totals.bookValue).toBe(290000);
    expect(r.totals.heldAway).toBe(50000);
    expect(r.totals.heldAwayAccounts).toBe(1);
    expect(r.totals.householdCount).toBe(2);
  });

  it("rolls up multiple clients in one household", () => {
    const r = aggregateBookBreakdown([
      row({ householdId: "h1", accountId: "a1", value: "100000.00", countsTowardAum: true }),
      row({ householdId: "h1", accountId: "a2", value: "100000.00", countsTowardAum: true }),
    ]);
    expect(r.households).toHaveLength(1);
    expect(r.households[0].bookValue).toBe(200000);
  });

  it("computes concentration: top-5 share, largest held-away, held-away household count", () => {
    const rows: BookQueryRow[] = [];
    // 6 households, book values 600..100k; the 6th falls out of top 5.
    for (let i = 1; i <= 6; i++) {
      rows.push(row({ householdId: `h${i}`, householdName: `H${i}`, accountId: `a${i}`, value: `${i * 100000}.00`, countsTowardAum: true }));
    }
    // held-away on two households
    rows.push(row({ householdId: "h1", householdName: "H1", accountId: "hz1", value: "40000.00", countsTowardAum: false }));
    rows.push(row({ householdId: "h2", householdName: "H2", accountId: "hz2", value: "70000.00", countsTowardAum: false }));
    const r = aggregateBookBreakdown(rows);
    // total book = 100k+200k+...+600k = 2.1M; top5 = drop the 100k = 2.0M -> 95%
    expect(r.concentration.top5BookSharePct).toBeCloseTo(95.238, 2);
    expect(r.concentration.largestHeldAway).toEqual({ householdName: "H2", value: 70000 });
    expect(r.concentration.heldAwayHouseholdCount).toBe(2);
  });
});
