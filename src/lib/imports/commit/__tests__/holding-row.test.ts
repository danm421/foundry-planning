import { describe, expect, it } from "vitest";
import { holdingRow } from "../holdings";
import type { ResolvedHoldingsMap } from "../types";

const resolved: ResolvedHoldingsMap = new Map([
  ["VTI", { securityId: "sec-vti", price: 300, asOf: "2026-10-30" }],
]);

describe("holdingRow, a classified ticker", () => {
  it("lets the live price drive the value when there are shares to multiply", () => {
    const row = holdingRow("acct", { ticker: "VTI", shares: 10, price: 250, marketValue: 2500 }, resolved, 0);
    expect(row).toMatchObject({ securityId: "sec-vti", shares: "10", price: "300", marketValue: null });
  });

  it("keeps the stated value when there are no shares — shares × price would be $0", () => {
    const row = holdingRow("acct", { ticker: "VTI", marketValue: 2500 }, resolved, 0);
    expect(row).toMatchObject({ securityId: "sec-vti", shares: "0", price: "300", marketValue: "2500" });
  });
});
