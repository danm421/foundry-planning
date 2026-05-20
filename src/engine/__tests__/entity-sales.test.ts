import { describe, it, expect } from "vitest";
import { applyEntitySales } from "../asset-transactions";
import type { Account, AccountLedger, AssetTransaction } from "../types";
import type { AccountOwner } from "../ownership";

function makeChecking(id: string, balance: number): Account {
  return {
    id,
    name: "Checking",
    category: "cash",
    subType: "checking",
    titlingType: "jtwros",
    value: balance,
    basis: balance,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: true,
    owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
  };
}

function makeLedger(balance: number): AccountLedger {
  return {
    beginningValue: balance,
    growth: 0,
    contributions: 0,
    distributions: 0,
    internalContributions: 0,
    internalDistributions: 0,
    rmdAmount: 0,
    fees: 0,
    endingValue: balance,
    entries: [],
    basisBoY: balance,
  };
}

describe("applyEntitySales — operating-value-only case", () => {
  it("full sale of entity with no owned accounts realizes operating gain and credits checking", () => {
    const checking = makeChecking("acct-cash", 1_000);
    const accounts = [checking];
    const accountBalances: Record<string, number> = { "acct-cash": 1_000 };
    const basisMap: Record<string, number> = { "acct-cash": 1_000 };
    const accountLedgers: Record<string, AccountLedger> = { "acct-cash": makeLedger(1_000) };

    const sale: AssetTransaction = {
      id: "tx-1",
      name: "Sell LLC",
      type: "sell",
      year: 2030,
      entityId: "E1",
      fractionSold: 1,
    };

    const result = applyEntitySales({
      sales: [sale],
      entities: [
        {
          id: "E1",
          name: "BobsLLC",
          entityType: "llc",
          value: 500_000,
          basis: 100_000,
          owners: [{ familyMemberId: "B", percent: 1 }],
        },
      ],
      accounts,
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    // Gain = 500k - 100k = 400k
    expect(result.capitalGains).toBe(400_000);
    expect(result.capitalGainsByOwner).toEqual({ B: 400_000 });
    expect(result.removedEntityIds).toEqual(["E1"]);
    // Net proceeds = 500k (no costs, no liabilities)
    expect(accountBalances["acct-cash"]).toBe(1_000 + 500_000);
  });

  it("full sale with 60/40 ownership splits cap gain across owners", () => {
    const checking = makeChecking("acct-cash", 0);
    const accountBalances: Record<string, number> = { "acct-cash": 0 };
    const basisMap: Record<string, number> = { "acct-cash": 0 };
    const accountLedgers: Record<string, AccountLedger> = { "acct-cash": makeLedger(0) };

    const result = applyEntitySales({
      sales: [
        {
          id: "tx-1",
          name: "Sell LLC",
          type: "sell",
          year: 2030,
          entityId: "E1",
          fractionSold: 1,
        },
      ],
      entities: [
        {
          id: "E1",
          name: "BobsLLC",
          entityType: "llc",
          value: 100_000,
          basis: 0,
          owners: [
            { familyMemberId: "B", percent: 0.6 },
            { familyMemberId: "M", percent: 0.4 },
          ],
        },
      ],
      accounts: [checking],
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    expect(result.capitalGains).toBe(100_000);
    expect(result.capitalGainsByOwner["B"]).toBeCloseTo(60_000, 6);
    expect(result.capitalGainsByOwner["M"]).toBeCloseTo(40_000, 6);
  });

  it("skips a trust entity with a diagnostic", () => {
    const checking = makeChecking("acct-cash", 0);
    const result = applyEntitySales({
      sales: [{ id: "tx-1", name: "x", type: "sell", year: 2030, entityId: "TR1", fractionSold: 1 }],
      entities: [
        {
          id: "TR1",
          name: "Family Trust",
          entityType: "trust",
          value: 0,
          basis: 0,
          owners: [],
        },
      ],
      accounts: [checking],
      liabilities: [],
      accountBalances: { "acct-cash": 0 },
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    expect(result.removedEntityIds).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ transactionId: "tx-1", reason: "trust-not-sellable" }),
    );
  });
});

function makeBrokerage(
  id: string,
  owners: AccountOwner[],
  balance: number,
  basis: number,
): Account {
  return {
    id,
    name: "Brokerage",
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value: balance,
    basis,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: false,
    owners,
  };
}

describe("applyEntitySales — account cascade", () => {
  it("full sale with entity owning 60% of brokerage liquidates 60% and rebalances", () => {
    const checking = makeChecking("acct-cash", 0);
    const brokerage = makeBrokerage(
      "acct-brok",
      [
        { kind: "family_member", familyMemberId: "B", percent: 0.4 },
        { kind: "entity", entityId: "E1", percent: 0.6 },
      ],
      100_000,
      40_000,
    );

    const accounts = [checking, brokerage];
    const accountBalances: Record<string, number> = {
      "acct-cash": 0,
      "acct-brok": 100_000,
    };
    const basisMap: Record<string, number> = {
      "acct-cash": 0,
      "acct-brok": 40_000,
    };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(0),
      "acct-brok": makeLedger(100_000),
    };

    const result = applyEntitySales({
      sales: [
        {
          id: "tx-1",
          name: "Sell LLC",
          type: "sell",
          year: 2030,
          entityId: "E1",
          fractionSold: 1,
        },
      ],
      entities: [
        {
          id: "E1",
          name: "BobsLLC",
          entityType: "llc",
          value: 0,
          basis: 0,
          owners: [{ familyMemberId: "B", percent: 1 }],
        },
      ],
      accounts,
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    // 60% of $100k = $60k liquidated; basis on that share = 60% × $40k = $24k → gain $36k
    expect(accountBalances["acct-brok"]).toBeCloseTo(40_000, 4);
    expect(result.capitalGains).toBeCloseTo(36_000, 4);
    expect(accountBalances["acct-cash"]).toBeCloseTo(60_000, 4);

    // Owners rebalanced: B now sole owner at 100%
    const brokAfter = accounts.find((a) => a.id === "acct-brok")!;
    expect(brokAfter.owners).toHaveLength(1);
    expect(brokAfter.owners[0]).toEqual(
      expect.objectContaining({
        kind: "family_member",
        familyMemberId: "B",
        percent: 1,
      }),
    );

    expect(result.breakdown[0].cascadedAccountIds).toEqual(["acct-brok"]);
    expect(result.breakdown[0].cascadedCapitalGain).toBeCloseTo(36_000, 4);
  });

  it("partial sale (f=0.3) with entity owning 60% liquidates 18% and rebalances", () => {
    const checking = makeChecking("acct-cash", 0);
    const brokerage = makeBrokerage(
      "acct-brok",
      [
        { kind: "family_member", familyMemberId: "B", percent: 0.4 },
        { kind: "entity", entityId: "E1", percent: 0.6 },
      ],
      100_000,
      40_000,
    );

    const accounts = [checking, brokerage];
    const result = applyEntitySales({
      sales: [
        {
          id: "tx-1",
          name: "Partial sell",
          type: "sell",
          year: 2030,
          entityId: "E1",
          fractionSold: 0.3,
        },
      ],
      entities: [
        {
          id: "E1",
          name: "BobsLLC",
          entityType: "llc",
          value: 0,
          basis: 0,
          owners: [{ familyMemberId: "B", percent: 1 }],
        },
      ],
      accounts,
      liabilities: [],
      accountBalances: { "acct-cash": 0, "acct-brok": 100_000 },
      basisMap: { "acct-cash": 0, "acct-brok": 40_000 },
      accountLedgers: {
        "acct-cash": makeLedger(0),
        "acct-brok": makeLedger(100_000),
      },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    // 0.3 × 0.6 = 0.18 of account liquidated → 18,000
    // basis on that share = 0.18 × 40,000 = 7,200 → gain 10,800
    expect(result.capitalGains).toBeCloseTo(10_800, 4);

    // Entity remains in owners with renormalized percent: 0.6 × 0.7 / 0.82 ≈ 0.5122
    const brokAfter = accounts.find((a) => a.id === "acct-brok")!;
    expect(brokAfter.owners).toHaveLength(2);
    const entityRow = brokAfter.owners.find((o) => o.kind === "entity") as {
      percent: number;
    };
    const fmRow = brokAfter.owners.find((o) => o.kind === "family_member") as {
      percent: number;
    };
    expect(entityRow.percent).toBeCloseTo(0.42 / 0.82, 4);
    expect(fmRow.percent).toBeCloseTo(0.4 / 0.82, 4);
  });
});
