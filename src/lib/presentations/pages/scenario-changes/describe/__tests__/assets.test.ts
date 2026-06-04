import { describe, it, expect } from "vitest";
import { describeChange } from "../index";
import { buildResolveContext } from "../resolve";

describe("transfer/account describers", () => {
  it("transfer add shows amount, source → target, mode, timing", () => {
    const resolve = buildResolveContext({
      accountsById: {
        s: { name: "Joint Brokerage", category: "taxable" },
        t: { name: "Business", category: "business" },
      },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "transfer",
        targetId: "tr1", toggleGroupId: null, orderIndex: 0,
        payload: {
          sourceAccountId: "s", targetAccountId: "t",
          amount: 250000, mode: "one_time", startYear: 2027,
        },
      },
      { targetNames: { "transfer:tr1": "cash to business" }, resolve },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Assets");
    expect(d).toContain("$250k");
    expect(d).toContain("Joint Brokerage");
    expect(d).toContain("Business");
    expect(d).toContain("2027");
  });

  it("transfer add with recurring mode shows year range", () => {
    const resolve = buildResolveContext({
      accountsById: {
        s: { name: "Checking", category: "cash" },
        t: { name: "Brokerage", category: "taxable" },
      },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c2", scenarioId: "s", opType: "add", targetKind: "transfer",
        targetId: "tr2", toggleGroupId: null, orderIndex: 0,
        payload: {
          sourceAccountId: "s", targetAccountId: "t",
          amount: 10000, mode: "recurring", startYear: 2027, endYear: 2035,
        },
      },
      { targetNames: {}, resolve },
    );
    const d = row.detail.join(" ");
    expect(d).toContain("2027");
    expect(d).toContain("2035");
  });

  it("transfer remove", () => {
    const resolve = buildResolveContext({
      accountsById: {}, recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c3", scenarioId: "s", opType: "remove", targetKind: "transfer",
        targetId: "tr3", toggleGroupId: null, orderIndex: 0, payload: {},
      },
      { targetNames: { "transfer:tr3": "My Transfer" }, resolve },
    );
    expect(row.area).toBe("Assets");
    expect(row.op).toBe("remove");
    expect(row.what).toBe("My Transfer");
  });

  it("account add shows category and value", () => {
    const resolve = buildResolveContext({
      accountsById: {}, recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c4", scenarioId: "s", opType: "add", targetKind: "account",
        targetId: "ac1", toggleGroupId: null, orderIndex: 0,
        payload: { category: "taxable", value: 50000 },
      },
      { targetNames: { "account:ac1": "My Brokerage" }, resolve },
    );
    const d = row.detail.join(" ");
    expect(row.area).toBe("Assets");
    expect(d).toContain("Taxable");
    expect(d).toContain("$50k");
  });

  it("transfer_schedule add shows custom schedule copy", () => {
    const resolve = buildResolveContext({
      accountsById: {}, recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c5", scenarioId: "s", opType: "add", targetKind: "transfer_schedule",
        targetId: "ts1", toggleGroupId: null, orderIndex: 0, payload: {},
      },
      { targetNames: { "transfer_schedule:ts1": "Annual Gift Schedule" }, resolve },
    );
    expect(row.area).toBe("Assets");
    expect(row.detail.join(" ")).toContain("Custom per-year");
  });

  it("asset_transaction sell shows asset, year, value, proceeds, exclusion", () => {
    const resolve = buildResolveContext({
      accountsById: {
        acc: { name: "Rental Home", category: "real_estate" },
        pr: { name: "Joint Brokerage", category: "taxable" },
      },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "asset_transaction",
        targetId: "x", toggleGroupId: null, orderIndex: 0,
        payload: { type: "sell", accountId: "acc", overrideSaleValue: 850000, proceedsAccountId: "pr", year: 2030, qualifiesForHomeSaleExclusion: true },
      },
      { targetNames: { "asset_transaction:x": "Sell Real Estate" }, resolve },
    );
    const d = row.detail.join(" ");
    expect(d).toContain("Sell"); expect(d).toContain("$850k"); expect(d).toContain("Joint Brokerage");
    expect(d).toContain("2030"); expect(d.toLowerCase()).toContain("exclusion");
  });

  it("asset_transaction sell shows computed sale value + net proceeds from the projection", () => {
    const resolve = buildResolveContext({
      accountsById: {
        acc: { name: "Rental Home", category: "real_estate" },
        pr: { name: "Schwab Ind. Account", category: "taxable" },
      },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
      assetTxById: {
        x: {
          type: "sell", saleValue: 650000, netProceeds: 610000,
          capitalGain: 300000, transactionCosts: 40000, mortgagePaidOff: 0,
        },
      },
    });
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "asset_transaction",
        targetId: "x", toggleGroupId: null, orderIndex: 0,
        // No overrideSaleValue — the value must come from the projection.
        payload: { type: "sell", accountId: "acc", proceedsAccountId: "pr", year: 2035, qualifiesForHomeSaleExclusion: false },
      },
      { targetNames: { "asset_transaction:x": "Sell Real Estate" }, resolve },
    );
    const d = row.detail.join(" ");
    expect(d).toContain("$650k");                 // computed sale value
    expect(d).toContain("$610k");                 // net proceeds
    expect(d.toLowerCase()).toContain("net");
    expect(d).toContain("Schwab Ind. Account");
    expect(d).toContain("2035");
  });

  it("asset_transaction sell falls back to overrideSaleValue when no computed data", () => {
    const resolve = buildResolveContext({
      accountsById: {
        acc: { name: "Rental Home", category: "real_estate" },
        pr: { name: "Joint Brokerage", category: "taxable" },
      },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "asset_transaction",
        targetId: "x", toggleGroupId: null, orderIndex: 0,
        payload: { type: "sell", accountId: "acc", overrideSaleValue: 850000, proceedsAccountId: "pr", year: 2030 },
      },
      { targetNames: {}, resolve },
    );
    expect(row.detail.join(" ")).toContain("$850k");
  });

  it("asset_transaction buy shows computed purchase price + mortgage from the projection", () => {
    const resolve = buildResolveContext({
      accountsById: { f: { name: "Cash", category: "cash" } },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
      assetTxById: { y: { type: "buy", purchasePrice: 600000, mortgageAmount: 400000, equity: 200000 } },
    });
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "asset_transaction",
        targetId: "y", toggleGroupId: null, orderIndex: 0,
        // No purchasePrice/mortgageAmount in payload — both come from the projection.
        payload: { type: "buy", assetName: "Rental Property", year: 2028, fundingAccountId: "f", mortgageRate: 0.065 },
      },
      { targetNames: {}, resolve },
    );
    const d = row.detail.join(" ");
    expect(d).toContain("Buy"); expect(d).toContain("Rental Property");
    expect(d).toContain("$600k"); expect(d).toContain("$400k"); expect(d).toContain("Cash");
  });

  it("asset_transaction buy shows asset, price, year, funding, mortgage", () => {
    const resolve = buildResolveContext({
      accountsById: { f: { name: "Cash", category: "cash" } },
      recipientsById: {}, entitiesById: {}, spouseName: null,
      modelPortfoliosById: {}, baseAllocationsById: {},
    });
    const row = describeChange(
      {
        id: "c", scenarioId: "s", opType: "add", targetKind: "asset_transaction",
        targetId: "y", toggleGroupId: null, orderIndex: 0,
        payload: { type: "buy", assetName: "Rental Property", purchasePrice: 600000, year: 2028, fundingAccountId: "f", mortgageAmount: 400000, mortgageRate: 0.065 },
      },
      { targetNames: {}, resolve },
    );
    const d = row.detail.join(" ");
    expect(d).toContain("Buy"); expect(d).toContain("Rental Property"); expect(d).toContain("$600k");
    expect(d).toContain("Cash"); expect(d).toContain("$400k");
  });
});
