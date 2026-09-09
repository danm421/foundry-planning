import { describe, it, expect } from "vitest";
import { detectRollups } from "@/lib/statement-chat/rollups";

const acct = (name: string, value: number, custodian = "Capital One") => ({
  name,
  value,
  custodian,
  accountNumberLast4: name.slice(-4),
});

describe("detectRollups", () => {
  it("excludes a row whose value is the sum of its siblings", () => {
    const { kept, excluded } = detectRollups([
      acct("Kids Savings - Morgan", 13_677.64),
      acct("Kids Savings - Sienna", 7_479.31),
      acct("All Accounts", 21_156.95),
    ]);
    expect(kept.map((r) => r.name)).toEqual([
      "Kids Savings - Morgan",
      "Kids Savings - Sienna",
    ]);
    expect(excluded[0].decision).toEqual({
      kind: "rollup-excluded",
      label: "All Accounts",
      value: 21_156.95,
      coversCount: 2,
    });
  });

  it("excludes a total-labelled row that exceeds every sibling even when the sum is off", () => {
    const { kept, excluded } = detectRollups([
      acct("401(k) Pre-Tax", 300_000),
      acct("401(k) Roth", 150_000),
      acct("Total Plan Analysis", 504_125.12),
    ]);
    expect(kept).toHaveLength(2);
    expect(excluded[0].decision.label).toBe("Total Plan Analysis");
  });

  it("never excludes the only row on a single-account statement", () => {
    const { kept, excluded } = detectRollups([acct("Total Account Value", 50_000)]);
    expect(kept).toHaveLength(1);
    expect(excluded).toHaveLength(0);
  });

  it("does not reconcile across custodians", () => {
    const { excluded } = detectRollups([
      acct("Checking", 10_000, "Wells Fargo"),
      acct("Savings", 15_000, "Wells Fargo"),
      acct("Brokerage", 25_000, "Schwab"),
    ]);
    expect(excluded).toHaveLength(0);
  });

  it("leaves a genuine account alone when its value coincidentally sums", () => {
    const { kept } = detectRollups([
      acct("Savings A", 10_000),
      acct("Savings B", 15_000),
      acct("Brokerage", 25_000),
    ]);
    // No total-ish label, so the coincidence is not enough on its own.
    // (C1: without the tightened rule, this row is wrongly excluded because
    // its sum matches two siblings, and `kept` would have only 2 rows.)
    expect(kept).toHaveLength(3);
  });

  // --- C6: tests the brief was missing ---

  it("keeps a row with no value, and does not let it poison a sibling's sum", () => {
    const { kept, excluded } = detectRollups([
      { name: "Old Money Market (closed)", custodian: "Capital One", accountNumberLast4: "0000" },
      acct("Kids Savings - Morgan", 13_677.64),
      acct("Kids Savings - Sienna", 7_479.31),
      acct("All Accounts", 21_156.95),
    ]);
    expect(kept.map((r) => r.name)).toEqual([
      "Old Money Market (closed)",
      "Kids Savings - Morgan",
      "Kids Savings - Sienna",
    ]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].decision.label).toBe("All Accounts");
    // The valueless row was never counted as a sibling for the sum check.
    expect(excluded[0].decision.coversCount).toBe(2);
  });

  it("groups accounts with no readable custodian into one bucket, but only excludes a labelled total", () => {
    const { kept, excluded } = detectRollups([
      { name: "Loose Checking", value: 5_000, custodian: undefined, accountNumberLast4: "1111" },
      { name: "Loose Savings", value: 3_000, custodian: "LLC", accountNumberLast4: "2222" },
      { name: "Total Balance", value: 8_000, custodian: "---", accountNumberLast4: "3333" },
    ]);
    // "LLC" and "---" both normalize to null, same as an absent custodian,
    // so all three rows are siblings of one another in the "__unknown__"
    // bucket — and the labelled, reconciling row is correctly excluded.
    expect(kept.map((r) => r.name)).toEqual(["Loose Checking", "Loose Savings"]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].decision).toEqual({
      kind: "rollup-excluded",
      label: "Total Balance",
      value: 8_000,
      coversCount: 2,
    });
  });

  it("keeps a totally-labelled row when it neither sums to nor exceeds its siblings", () => {
    const { kept, excluded } = detectRollups([
      acct("Total Group A", 100),
      acct("Brokerage", 500),
      acct("Municipal Bonds", 600),
    ]);
    // Has a total-ish label, but 100 is neither >= the largest sibling (600)
    // nor within tolerance of the sibling sum (1,100) — so it must survive.
    // This is the assertion that pins the `&&`: a label alone is not enough.
    expect(kept.map((r) => r.name)).toEqual(["Total Group A", "Brokerage", "Municipal Bonds"]);
    expect(excluded).toHaveLength(0);
  });

  // --- C8: kept/excluded order must match input order, not custodian-group order ---

  it("preserves input order across multiple custodians", () => {
    const { kept } = detectRollups([
      acct("Checking", 10_000, "Wells Fargo"),
      acct("Brokerage", 25_000, "Schwab"),
      acct("Savings", 15_000, "Wells Fargo"),
      acct("Muni Bonds", 5_000, "Schwab"),
    ]);
    // Grouping by custodian internally must not leak into the output order:
    // if it did, this would come back Wells-Fargo-first.
    expect(kept.map((r) => r.name)).toEqual(["Checking", "Brokerage", "Savings", "Muni Bonds"]);
  });
});
