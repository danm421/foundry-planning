import { describe, expect, it } from "vitest";
import { reviewStatementHoldings } from "@/lib/extraction/holdings-checks";
import type { ExtractedAccount } from "@/lib/extraction/types";
import { holdingRow } from "@/lib/imports/commit/holdings";
import type { ResolvedHoldingsMap } from "@/lib/imports/commit/types";
import { buildHoldingsInventory, type HoldingRowInput } from "@/lib/investments/holdings-inventory";
import {
  BROKERAGE_CORRECT_READ,
  BROKERAGE_READ_2026_10_21,
  BROKERAGE_TEXT,
} from "@/lib/extraction/__tests__/fixtures/schwab-statements-2026-04";

/**
 * A statement's positions from the read, through the row commit writes and
 * the column types it lands in, to the holdings report's rows. Live prices
 * are October's, not the statement's April ones: a position's value moves
 * with the market, its cost basis must not.
 */
const LIVE: Record<string, number> = { NVDA: 216.47, TSLA: 373.71, AMZN: 262.63, CASH: 73.93 };
const resolved: ResolvedHoldingsMap = new Map(
  Object.entries(LIVE).map(([t, price]) => [t, { securityId: `sec-${t}`, price, asOf: "2026-10-20" }]),
);

/** What Postgres hands back for the row: numeric(18,6) shares, (15,4) price, (15,2) basis and value. */
function asStored(row: ReturnType<typeof holdingRow>, id: number): HoldingRowInput {
  return {
    id: String(id),
    displayTicker: row.displayTicker,
    displayName: row.displayName,
    shares: Number(row.shares).toFixed(6),
    price: Number(row.price).toFixed(4),
    priceAsOf: row.priceAsOf,
    costBasis: Number(row.costBasis).toFixed(2),
    marketValue: row.marketValue == null ? null : Number(row.marketValue).toFixed(2),
  };
}

function report(account: ExtractedAccount) {
  const { account: checked } = reviewStatementHoldings(account, BROKERAGE_TEXT);
  const rows = checked.holdings!.map((h, i) => asStored(holdingRow("acct", h, resolved, i), i));
  const [group] = buildHoldingsInventory(new Map([["acct", rows]]), new Map([["acct", { name: account.name, category: "taxable" }]]));
  return { rows, group };
}

describe("a Schwab brokerage statement, read → commit row → holdings report", () => {
  it("reports each position's printed cost basis, its gain from the live price", () => {
    const { group } = report(BROKERAGE_CORRECT_READ as ExtractedAccount);
    const nvda = group.holdings.find((h) => h.ticker === "NVDA")!;
    expect(nvda).toMatchObject({ shares: 22277, price: 216.47, costBasis: 38008.19 });
    expect(nvda.gainLoss).toBeCloseTo(22277 * 216.47 - 38008.19, 2);
    expect(group.holdings.find((h) => h.ticker === "TSLA")!.costBasis).toBe(105235.55);
    expect(group.holdings.find((h) => h.ticker === "AMZN")!.costBasis).toBe(35589.12);
  });

  it("reports cash at $1 a dollar even with the CASH stock in the price map", () => {
    const { rows, group } = report(BROKERAGE_CORRECT_READ as ExtractedAccount);
    const cash = group.holdings.find((h) => h.name === "Cash")!;
    expect(cash).toMatchObject({ ticker: "", shares: 22598.53, price: 1, marketValue: 22598.53 });
    expect(rows.find((r) => r.displayName === "Cash")).toMatchObject({ displayTicker: null, price: "1.0000" });
  });

  it("never links the 2026-10-21 read's 'Cash' line to the CASH stock", () => {
    const { account } = reviewStatementHoldings(BROKERAGE_READ_2026_10_21 as ExtractedAccount, BROKERAGE_TEXT);
    const cashLine = account.holdings!.find((h) => h.name === "Cash")!;
    const row = holdingRow("acct", { ...cashLine, ticker: "Cash" }, resolved, 0);
    expect(row).toMatchObject({ securityId: null, displayTicker: null, price: "1", marketValue: "22518.53" });
  });

  it("reports a missing basis as missing, not $0", () => {
    const { group } = report(BROKERAGE_CORRECT_READ as ExtractedAccount);
    expect(group.holdings.find((h) => h.ticker === "QQQ")).toMatchObject({ costBasis: null, gainLoss: null });
  });
});
