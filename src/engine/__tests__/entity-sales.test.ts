import { describe, it, expect } from "vitest";
import { applyEntitySales } from "../asset-transactions";
import type { Account, AccountLedger, AssetTransaction, Liability } from "../types";
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
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
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
            { kind: "family_member", familyMemberId: "B", percent: 0.6 },
            { kind: "family_member", familyMemberId: "M", percent: 0.4 },
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

  it("fractionSold = 0 produces an invalid-fraction diagnostic", () => {
    const checking = makeChecking("acct-cash", 0);
    const result = applyEntitySales({
      sales: [
        {
          id: "tx-1",
          name: "Sell LLC",
          type: "sell",
          year: 2030,
          entityId: "E1",
          fractionSold: 0,
        },
      ],
      entities: [
        {
          id: "E1",
          name: "BobsLLC",
          entityType: "llc",
          value: 100_000,
          basis: 0,
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
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

    expect(result.capitalGains).toBe(0);
    expect(result.removedEntityIds).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ transactionId: "tx-1", reason: "invalid-fraction" }),
    );
  });

  it("fractionSold = 1.5 produces an invalid-fraction diagnostic", () => {
    const checking = makeChecking("acct-cash", 0);
    const result = applyEntitySales({
      sales: [
        {
          id: "tx-1",
          name: "Sell LLC",
          type: "sell",
          year: 2030,
          entityId: "E1",
          fractionSold: 1.5,
        },
      ],
      entities: [
        {
          id: "E1",
          name: "BobsLLC",
          entityType: "llc",
          value: 100_000,
          basis: 0,
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
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

    expect(result.capitalGains).toBe(0);
    expect(result.removedEntityIds).toEqual([]);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ transactionId: "tx-1", reason: "invalid-fraction" }),
    );
  });

  it("partial operating-only sale (f=0.5) without owned accounts halves gain and proceeds", () => {
    const checking = makeChecking("acct-cash", 0);
    const accountBalances: Record<string, number> = { "acct-cash": 0 };
    const basisMap: Record<string, number> = { "acct-cash": 0 };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(0),
    };

    const result = applyEntitySales({
      sales: [
        {
          id: "tx-1",
          name: "Half sell LLC",
          type: "sell",
          year: 2030,
          entityId: "E1",
          fractionSold: 0.5,
        },
      ],
      entities: [
        {
          id: "E1",
          name: "BobsLLC",
          entityType: "llc",
          value: 100_000,
          basis: 0,
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
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

    // f=0.5 × ($100k - $0) = $50k cap gain
    expect(result.capitalGains).toBeCloseTo(50_000, 6);
    // Gross proceeds = f × value = $50k, no costs/liabilities so net = $50k
    expect(accountBalances["acct-cash"]).toBeCloseTo(50_000, 6);
    // Partial sale → entity not removed
    expect(result.removedEntityIds).toEqual([]);
  });

  it("owner percents summing to 0.95 normalize pro-rata and emit owner-percents-not-summing-to-one diagnostic", () => {
    const checking = makeChecking("acct-cash", 0);
    const accountBalances: Record<string, number> = { "acct-cash": 0 };
    const basisMap: Record<string, number> = { "acct-cash": 0 };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(0),
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
          value: 100_000,
          basis: 0,
          // Legacy data: owners sum to 0.95 instead of 1.
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 0.95 }],
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

    // Aggregate cap gain still reflects the full sale.
    expect(result.capitalGains).toBeCloseTo(100_000, 6);
    // After normalization, per-owner total equals the aggregate.
    const perOwnerSum = Object.values(result.capitalGainsByOwner).reduce(
      (s, v) => s + v,
      0,
    );
    expect(perOwnerSum).toBeCloseTo(result.capitalGains, 6);
    expect(result.capitalGainsByOwner["B"]).toBeCloseTo(100_000, 6);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        transactionId: "tx-1",
        reason: "owner-percents-not-summing-to-one",
      }),
    );
  });

  it("empty defaultCheckingId emits no-default-checking diagnostic; cap gain still recognized; cash not deposited", () => {
    const checking = makeChecking("acct-cash", 1_000);
    const accountBalances: Record<string, number> = { "acct-cash": 1_000 };
    const basisMap: Record<string, number> = { "acct-cash": 1_000 };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(1_000),
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
          value: 500_000,
          basis: 100_000,
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
        },
      ],
      accounts: [checking],
      liabilities: [],
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "",
    });

    // Cap gain still recognized.
    expect(result.capitalGains).toBeCloseTo(400_000, 6);
    expect(result.capitalGainsByOwner["B"]).toBeCloseTo(400_000, 6);
    // No cash deposited anywhere — checking balance untouched.
    expect(accountBalances["acct-cash"]).toBe(1_000);
    expect(basisMap["acct-cash"]).toBe(1_000);
    expect(accountLedgers["acct-cash"].contributions).toBe(0);
    // Diagnostic emitted.
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        transactionId: "tx-1",
        reason: "no-default-checking",
      }),
    );
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
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
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
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
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

    // Breakdown shape: cascaded account ids + cap-gain reported per breakdown row.
    expect(result.breakdown[0].cascadedAccountIds).toEqual(["acct-brok"]);
    expect(result.breakdown[0].cascadedCapitalGain).toBeCloseTo(10_800, 4);
  });
});

function makeProperty(
  id: string,
  owners: AccountOwner[],
  balance: number,
  basis: number,
): Account {
  return {
    id,
    name: "Property",
    category: "real_estate",
    subType: "residence",
    titlingType: "jtwros",
    value: balance,
    basis,
    growthRate: 0,
    rmdEnabled: false,
    isDefaultChecking: false,
    owners,
  };
}

describe("applyEntitySales — linked-mortgage double-payoff regression", () => {
  it("entity-only ownership of property + linked mortgage avoids double-payoff", () => {
    const checking = makeChecking("acct-cash", 0);
    const property = makeProperty(
      "prop",
      [{ kind: "entity", entityId: "E1", percent: 1 }],
      300_000,
      200_000,
    );
    const accounts = [checking, property];
    const accountBalances: Record<string, number> = {
      "acct-cash": 0,
      prop: 300_000,
    };
    const basisMap: Record<string, number> = {
      "acct-cash": 0,
      prop: 200_000,
    };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(0),
      prop: makeLedger(300_000),
    };
    const liabilities: Liability[] = [
      {
        id: "L1",
        name: "Mortgage",
        balance: 50_000,
        interestRate: 0.05,
        monthlyPayment: 0,
        startYear: 2025,
        startMonth: 1,
        termMonths: 360,
        linkedPropertyId: "prop",
        isInterestDeductible: false,
        extraPayments: [],
        owners: [{ kind: "entity", entityId: "E1", percent: 1 }],
      },
    ];

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
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
        },
      ],
      accounts,
      liabilities,
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    // Cash increases by exactly $250k (property nets 300k - 50k mortgage payoff
    // inside sellAccountFraction; entity itself has no operating value).
    expect(accountBalances["acct-cash"]).toBeCloseTo(250_000, 4);
    // Single-counted: only the helper's $50k payoff shows up.
    expect(result.totalLiabilityPaydown).toBeCloseTo(50_000, 4);
    // Removed-liability list contains L1 exactly once.
    const l1Count = result.removedLiabilityIds.filter((id) => id === "L1").length;
    expect(l1Count).toBe(1);
    expect(result.removedAccountIds).toContain("prop");
  });
});

describe("applyEntitySales — liability cascade", () => {
  it("full sale pays off entity's share of a co-owned liability", () => {
    const checking = makeChecking("acct-cash", 0);
    const accounts = [checking];
    const accountBalances: Record<string, number> = { "acct-cash": 0 };
    const basisMap: Record<string, number> = { "acct-cash": 0 };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(0),
    };
    const liabilities: Liability[] = [
      {
        id: "lia-1",
        name: "Business loan",
        balance: 200_000,
        interestRate: 0.05,
        monthlyPayment: 0,
        startYear: 2025,
        startMonth: 1,
        termMonths: 360,
        isInterestDeductible: false,
        extraPayments: [],
        owners: [
          { kind: "family_member", familyMemberId: "B", percent: 0.4 },
          { kind: "entity", entityId: "E1", percent: 0.6 },
        ],
      },
    ];

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
          value: 500_000,
          basis: 500_000,
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
        },
      ],
      accounts,
      liabilities,
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    // 60% of $200k = $120k paydown
    expect(result.totalLiabilityPaydown).toBeCloseTo(120_000, 4);
    expect(liabilities[0].balance).toBeCloseTo(80_000, 4);

    // Owners rebalanced: B now sole owner of remaining 80k
    expect(liabilities[0].owners).toHaveLength(1);
    expect(liabilities[0].owners[0]).toEqual(
      expect.objectContaining({
        kind: "family_member",
        familyMemberId: "B",
        percent: 1,
      }),
    );

    // Net proceeds = 500k operating - 0 costs - 120k paydown = 380k
    expect(accountBalances["acct-cash"]).toBeCloseTo(380_000, 4);
    expect(result.breakdown[0].cascadedLiabilityIds).toEqual(["lia-1"]);
  });

  it("partial sale (f=0.5) of entity owning 60% of liability pays down 0.5×0.6×balance and renormalizes owners", () => {
    const checking = makeChecking("acct-cash", 0);
    const accounts = [checking];
    const accountBalances: Record<string, number> = { "acct-cash": 0 };
    const basisMap: Record<string, number> = { "acct-cash": 0 };
    const accountLedgers: Record<string, AccountLedger> = {
      "acct-cash": makeLedger(0),
    };
    const liabilities: Liability[] = [
      {
        id: "lia-3",
        name: "Business loan",
        balance: 200_000,
        interestRate: 0.05,
        monthlyPayment: 0,
        startYear: 2025,
        startMonth: 1,
        termMonths: 360,
        isInterestDeductible: false,
        extraPayments: [],
        owners: [
          { kind: "family_member", familyMemberId: "B", percent: 0.4 },
          { kind: "entity", entityId: "E1", percent: 0.6 },
        ],
      },
    ];

    const result = applyEntitySales({
      sales: [
        {
          id: "tx-1",
          name: "Half-sell LLC",
          type: "sell",
          year: 2030,
          entityId: "E1",
          fractionSold: 0.5,
        },
      ],
      entities: [
        {
          id: "E1",
          name: "BobsLLC",
          entityType: "llc",
          value: 500_000,
          basis: 500_000,
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
        },
      ],
      accounts,
      liabilities,
      accountBalances,
      basisMap,
      accountLedgers,
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    // 0.5 × 0.6 × 200_000 = 60_000 paydown
    expect(result.totalLiabilityPaydown).toBeCloseTo(60_000, 4);
    expect(liabilities[0].balance).toBeCloseTo(140_000, 4);

    // Owners renormalize: entity goes 0.6×(1-0.5)=0.3 → 0.3/0.7≈0.4286;
    // family member 0.4/0.7≈0.5714.
    expect(liabilities[0].owners).toHaveLength(2);
    const entityRow = liabilities[0].owners.find(
      (o) => o.kind === "entity",
    ) as { percent: number };
    const fmRow = liabilities[0].owners.find(
      (o) => o.kind === "family_member",
    ) as { percent: number };
    expect(entityRow.percent).toBeCloseTo(0.3 / 0.7, 4);
    expect(fmRow.percent).toBeCloseTo(0.4 / 0.7, 4);
  });

  it("full payoff of entity-only liability marks it for removal", () => {
    const checking = makeChecking("acct-cash", 0);
    const liabilities: Liability[] = [
      {
        id: "lia-2",
        name: "Entity-only debt",
        balance: 50_000,
        interestRate: 0.05,
        monthlyPayment: 0,
        startYear: 2025,
        startMonth: 1,
        termMonths: 360,
        isInterestDeductible: false,
        extraPayments: [],
        owners: [{ kind: "entity", entityId: "E1", percent: 1 }],
      },
    ];

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
          basis: 100_000,
          owners: [{ kind: "family_member", familyMemberId: "B", percent: 1 }],
        },
      ],
      accounts: [checking],
      liabilities,
      accountBalances: { "acct-cash": 0 },
      basisMap: { "acct-cash": 0 },
      accountLedgers: { "acct-cash": makeLedger(0) },
      year: 2030,
      defaultCheckingId: "acct-cash",
    });

    expect(result.totalLiabilityPaydown).toBeCloseTo(50_000, 4);
    expect(liabilities[0].balance).toBeCloseTo(0, 4);
    expect(result.removedLiabilityIds).toContain("lia-2");
  });
});
