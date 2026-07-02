import { describe, it, expect } from "vitest";
import type { AccountHoldingsGroup } from "@/lib/investments/holdings-inventory";
import { buildHoldingsData } from "../view-model";
import { HOLDINGS_OPTIONS_DEFAULT } from "../options-schema";

// Shapes mirror buildHoldingsInventory output: pcts are fractions of the
// grand total across ALL accounts; groups arrive sorted by totalValue desc.
const GROUPS: AccountHoldingsGroup[] = [
  {
    accountId: "a1",
    accountName: "Joint Brokerage",
    category: "taxable",
    totalValue: 150_000,
    pctOfTotal: 0.75,
    holdings: [
      {
        id: "h1", ticker: "VTI", name: "Vanguard Total Stock Market ETF",
        shares: 400, price: 250, priceAsOf: "2026-06-30",
        marketValue: 100_000, pctOfTotal: 0.5,
        costBasis: 80_000, gainLoss: 20_000, gainLossPct: 0.25,
      },
      {
        id: "h2", ticker: "", name: "Private Fund LP",
        shares: 1, price: 50_000, priceAsOf: null,
        marketValue: 50_000, pctOfTotal: 0.25,
        costBasis: null, gainLoss: null, gainLossPct: null,
      },
    ],
  },
  {
    accountId: "a2",
    accountName: "Roth IRA",
    category: "retirement",
    totalValue: 50_000,
    pctOfTotal: 0.25,
    holdings: [
      {
        id: "h3", ticker: "BND", name: "Vanguard Total Bond Market ETF",
        shares: 700.1234, price: 71.42, priceAsOf: "2026-06-30",
        marketValue: 50_000, pctOfTotal: 0.25,
        costBasis: 55_000, gainLoss: -5_000, gainLossPct: -0.0909,
      },
    ],
  },
];

const INPUT = { holdings: GROUPS, reportDate: "July 2, 2026", options: HOLDINGS_OPTIONS_DEFAULT };

describe("buildHoldingsData — summary + grouped mode", () => {
  it("computes the summary band and one block per account", () => {
    const data = buildHoldingsData(INPUT);
    expect(data.title).toBe("Holdings");
    expect(data.subtitle).toBe("As of July 2, 2026");
    expect(data.totalValue).toBe("$200,000");
    expect(data.accountCount).toBe(2);
    expect(data.positionCount).toBe(3);
    expect(data.includeCostBasis).toBe(true);
    expect(data.flatRows).toBeNull();
    expect(data.accountBlocks).toHaveLength(2);
    expect(data.accountBlocks![0]).toMatchObject({
      accountName: "Joint Brokerage",
      category: "taxable",
      totalValue: "$150,000",
      pctOfTotal: "75.0%",
    });
  });

  it("formats holding rows with app parity", () => {
    const rows = buildHoldingsData(INPUT).accountBlocks![0].rows;
    expect(rows[0]).toEqual({
      ticker: "VTI",
      name: "Vanguard Total Stock Market ETF",
      shares: "400",
      price: "$250.00",
      marketValue: "$100,000",
      pctOfTotal: "50.0%",
      costBasis: "$80,000",
      gainLoss: { text: "+$20,000 (+25.0%)", tone: "good" },
    });
    // Null cost basis → null cells (renderer prints em-dashes)
    expect(rows[1].costBasis).toBeNull();
    expect(rows[1].gainLoss).toBeNull();
  });

  it("formats losses with crit tone and 4-decimal shares", () => {
    const row = buildHoldingsData(INPUT).accountBlocks![1].rows[0];
    expect(row.shares).toBe("700.1234");
    expect(row.price).toBe("$71.42");
    expect(row.gainLoss).toEqual({ text: "-$5,000 (-9.1%)", tone: "crit" });
  });
});

describe("buildHoldingsData — flat mode", () => {
  it("flattens across accounts sorted by market value desc", () => {
    const data = buildHoldingsData({
      ...INPUT,
      options: { groupByAccount: false, includeCostBasis: false },
    });
    expect(data.accountBlocks).toBeNull();
    expect(data.includeCostBasis).toBe(false);
    // $50k tie between Private Fund and BND: sortFlatHoldings is a stable
    // sort, so flatten order (Joint Brokerage group first) breaks the tie.
    expect(data.flatRows!.map((r) => r.ticker)).toEqual(["VTI", "", "BND"]);
    expect(data.flatRows![2].accountName).toBe("Roth IRA");
  });
});

describe("buildHoldingsData — empty states", () => {
  it("handles an absent bundle", () => {
    const data = buildHoldingsData({ ...INPUT, holdings: undefined });
    expect(data.positionCount).toBe(0);
    expect(data.accountCount).toBe(0);
    expect(data.totalValue).toBe("$0");
    expect(data.accountBlocks).toEqual([]);
  });

  it("handles zero groups in flat mode", () => {
    const data = buildHoldingsData({
      ...INPUT,
      holdings: [],
      options: { groupByAccount: false, includeCostBasis: true },
    });
    expect(data.flatRows).toEqual([]);
    expect(data.positionCount).toBe(0);
  });
});
