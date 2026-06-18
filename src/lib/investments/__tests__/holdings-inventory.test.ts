// src/lib/investments/__tests__/holdings-inventory.test.ts
import { describe, it, expect } from "vitest";
import {
  buildHoldingsInventory,
  type HoldingRowInput,
  type AccountMeta,
} from "../holdings-inventory";

function row(p: Partial<HoldingRowInput> & Pick<HoldingRowInput, "id">): HoldingRowInput {
  return {
    displayTicker: "TICK",
    displayName: "Name",
    shares: "0",
    price: "0",
    priceAsOf: null,
    costBasis: "0",
    marketValue: null,
    ...p,
  };
}

const META = new Map<string, AccountMeta>([
  ["a1", { name: "Brokerage", category: "taxable" }],
  ["a2", { name: "IRA", category: "retirement" }],
]);

describe("buildHoldingsInventory", () => {
  it("derives market value from shares*price when marketValue is null", () => {
    const map = new Map([["a1", [row({ id: "h1", shares: "10", price: "100" })]]]);
    const [g] = buildHoldingsInventory(map, META);
    expect(g.holdings[0].marketValue).toBe(1000);
    expect(g.totalValue).toBe(1000);
  });

  it("uses stored marketValue when present (bond/manual)", () => {
    const map = new Map([["a1", [row({ id: "h1", shares: "1000", price: "98.5", marketValue: "985000" })]]]);
    const [g] = buildHoldingsInventory(map, META);
    expect(g.holdings[0].marketValue).toBe(985000);
  });

  it("computes gain/loss when basis > 0 and nulls it when basis is 0", () => {
    const map = new Map([
      ["a1", [
        row({ id: "withBasis", shares: "10", price: "100", costBasis: "800" }),
        row({ id: "noBasis", shares: "10", price: "100", costBasis: "0" }),
      ]],
    ]);
    const [g] = buildHoldingsInventory(map, META);
    const withBasis = g.holdings.find((h) => h.id === "withBasis")!;
    const noBasis = g.holdings.find((h) => h.id === "noBasis")!;
    expect(withBasis.costBasis).toBe(800);
    expect(withBasis.gainLoss).toBe(200);
    expect(withBasis.gainLossPct).toBeCloseTo(0.25);
    expect(noBasis.costBasis).toBeNull();
    expect(noBasis.gainLoss).toBeNull();
    expect(noBasis.gainLossPct).toBeNull();
  });

  it("uses the grand total across ALL accounts for pctOfTotal", () => {
    const map = new Map([
      ["a1", [row({ id: "h1", shares: "1", price: "750" })]],
      ["a2", [row({ id: "h2", shares: "1", price: "250" })]],
    ]);
    const groups = buildHoldingsInventory(map, META);
    const a1 = groups.find((g) => g.accountId === "a1")!;
    const a2 = groups.find((g) => g.accountId === "a2")!;
    expect(a1.pctOfTotal).toBeCloseTo(0.75);
    expect(a2.pctOfTotal).toBeCloseTo(0.25);
    expect(a1.holdings[0].pctOfTotal).toBeCloseTo(0.75);
  });

  it("sorts groups by totalValue descending and omits empty accounts", () => {
    const map = new Map([
      ["a1", [row({ id: "h1", shares: "1", price: "100" })]],
      ["a2", [row({ id: "h2", shares: "1", price: "900" })]],
      ["a3", []],
    ]);
    const groups = buildHoldingsInventory(map, META);
    expect(groups.map((g) => g.accountId)).toEqual(["a2", "a1"]);
  });

  it("falls back to placeholder meta for unknown accounts and 0 pct on empty total", () => {
    const map = new Map([["zzz", [row({ id: "h1", shares: "0", price: "0" })]]]);
    const [g] = buildHoldingsInventory(map, META);
    expect(g.accountName).toBe("Unknown account");
    expect(g.holdings[0].pctOfTotal).toBe(0);
  });
});
