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
      acct("Total Brokerage", 25_000, "Schwab"),
    ]);
    // "Total Brokerage" carries a total-ish label AND its value (25,000)
    // reconciles exactly with Checking + Savings (10,000 + 15,000) — so this
    // is only kept because it's alone in the Schwab bucket. If custodian
    // grouping were broken (all three rows treated as one bucket), it would
    // be wrongly excluded, which is exactly what this test pins.
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

  // --- Fix round 1, CRITICAL: fund names veto the rollup check, even though
  // they routinely start with "Total" and are often the household's biggest
  // single position. ---

  it("keeps a real fund account even when it is the largest row on the statement", () => {
    const { kept, excluded } = detectRollups([
      acct("Municipal Bonds", 50_000),
      acct("Preferred Stock", 40_000),
      acct("Total Stock Market Index Fund Admiral Shares", 900_000),
    ]);
    // Without the veto, 900,000 > every sibling and this fund — the
    // household's biggest account — would be wrongly greyed out.
    expect(kept.map((r) => r.name)).toEqual([
      "Municipal Bonds",
      "Preferred Stock",
      "Total Stock Market Index Fund Admiral Shares",
    ]);
    expect(excluded).toHaveLength(0);
  });

  it("keeps a real fund account even when its value happens to sum to its siblings", () => {
    const { kept, excluded } = detectRollups([
      acct("Brokerage Cash", 100_000),
      acct("Municipal Bonds", 50_000),
      acct("PIMCO Total Return Fund", 150_000),
    ]);
    // Without the veto, 150,000 reconciles exactly with 100,000 + 50,000 —
    // a real fund holding would be wrongly excluded as a rollup.
    expect(kept.map((r) => r.name)).toEqual([
      "Brokerage Cash",
      "Municipal Bonds",
      "PIMCO Total Return Fund",
    ]);
    expect(excluded).toHaveLength(0);
  });

  // --- Fix round 1, IMPORTANT 1: pin the `sumsToSiblings` clause on its own,
  // isolated from the `value > largestSibling` clause, so it can't be
  // deleted without a test noticing. Both cases below are constructed so the
  // total's value does NOT exceed its largest sibling — only the sum check
  // can catch them. ---

  it("excludes a total that sums exactly but does not exceed any sibling, when a sibling is negative", () => {
    const { kept, excluded } = detectRollups([
      acct("Brokerage", 100_000),
      acct("Margin Loan", -40_000),
      acct("Total Account Value", 60_000),
    ]);
    // 100,000 + (-40,000) = 60,000 exactly, but 60,000 is not > 100,000
    // (the largest sibling) — only the sum rule catches this one.
    expect(kept.map((r) => r.name)).toEqual(["Brokerage", "Margin Loan"]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].decision.label).toBe("Total Account Value");
  });

  // --- Ruling 104: the custodian on a relationship-summary statement is
  // routinely spelled more formally than on the same institution's own
  // account statements. Exact-string bucketing gave that total zero
  // siblings, so it was never flagged and committed as a real account. ---

  it("excludes a Total Portfolio whose custodian is spelled more formally than its siblings'", () => {
    const { kept, excluded } = detectRollups([
      acct("Brokerage", 265_000, "Fidelity"),
      acct("Roth IRA", 180_000, "Fidelity"),
      acct("Total Portfolio", 445_000, "Fidelity Investments"),
    ]);
    // Live repro: this $445,000 row committed alongside the $265,000 and
    // $180,000 rows it sums, inflating the client's net worth by their own
    // total. "fidelity" and "fidelity investments" are different exact keys
    // but the same custodian.
    expect(kept.map((r) => r.name)).toEqual(["Brokerage", "Roth IRA"]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].decision).toEqual({
      kind: "rollup-excluded",
      label: "Total Portfolio",
      value: 445_000,
      coversCount: 2,
    });
  });

  // The guard on the other side: widening the comparison must not make two
  // genuinely different institutions siblings. "Fidelity" and "Fifth Third"
  // share a prefix as raw strings but are not a whole-word prefix of each
  // other, so this case does NOT actually discriminate `custodianMatches`
  // from a bare `startsWith`: neither implementation would match them (kept
  // for the always-true-matcher case it does still catch).
  it("does not make two different custodians siblings just because their names share a prefix", () => {
    const { kept, excluded } = detectRollups([
      acct("Checking", 10_000, "Fifth Third"),
      acct("Savings", 15_000, "Fifth Third"),
      acct("Total Portfolio", 25_000, "Fidelity"),
    ]);
    expect(kept.map((r) => r.name)).toEqual(["Checking", "Savings", "Total Portfolio"]);
    expect(excluded).toHaveLength(0);
  });

  // The case that actually pins `custodianMatches` over a bare `startsWith`:
  // "citi" IS a character-prefix of "citibank", so a bare `startsWith` would
  // wrongly call them siblings. `custodianMatches` requires a whole-word
  // prefix (`a.startsWith(`${b} `)`), and "citibank" has no space after
  // "citi", so it correctly treats them as different custodians.
  it("does not make 'citi' and 'citibank' siblings even though one is a character-prefix of the other", () => {
    const { kept, excluded } = detectRollups([
      acct("Checking", 10_000, "Citi"),
      acct("Savings", 15_000, "Citi"),
      acct("Total Portfolio", 25_000, "Citibank"),
    ]);
    expect(kept.map((r) => r.name)).toEqual(["Checking", "Savings", "Total Portfolio"]);
    expect(excluded).toHaveLength(0);
  });

  // Ruling 104 kept the ordering guarantee: siblings are now found by
  // scanning `rows`, so output order must still be INPUT order even when a
  // later row's custodian matches an earlier one's by prefix rather than
  // equality.
  it("preserves input order when custodians match by prefix rather than equality", () => {
    const { kept } = detectRollups([
      acct("Checking", 10_000, "Wells Fargo Bank"),
      acct("Brokerage", 25_000, "Fidelity Investments"),
      acct("Savings", 15_000, "Wells Fargo"),
      acct("Muni Bonds", 5_000, "Fidelity"),
    ]);
    expect(kept.map((r) => r.name)).toEqual(["Checking", "Brokerage", "Savings", "Muni Bonds"]);
  });

  it("excludes a total that reconciles only within tolerance, not exceeding its largest sibling", () => {
    const { kept, excluded } = detectRollups([
      acct("Brokerage", 100_000),
      acct("Cash Sweep", 1_000),
      acct("Total Account Value", 100_000),
    ]);
    // Siblings sum to 101,000; the total prints 100,000 — off by ~0.99%,
    // inside the 1% tolerance but NOT an exact match, so `withinTolerance`'s
    // real math is exercised rather than standing in for `===`. And
    // 100,000 is not > 100,000 (the largest sibling), so only the sum rule
    // catches it.
    expect(kept.map((r) => r.name)).toEqual(["Brokerage", "Cash Sweep"]);
    expect(excluded).toHaveLength(1);
    expect(excluded[0].decision.label).toBe("Total Account Value");
  });
});
