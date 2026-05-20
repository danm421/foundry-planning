import { describe, it, expect } from "vitest";
import { applyEntitySales } from "../asset-transactions";
import type { Account, AccountLedger, AssetTransaction } from "../types";

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
