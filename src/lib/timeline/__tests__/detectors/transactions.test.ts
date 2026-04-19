// src/lib/timeline/__tests__/detectors/transactions.test.ts
import { describe, it, expect } from "vitest";
import { detectTransactionEvents } from "../../detectors/transactions";
import { runProjection } from "@/engine";
import { buildClientData } from "@/engine/__tests__/fixtures";

describe("detectTransactionEvents", () => {
  it("emits a sale event with runtime figures from techniqueBreakdown", () => {
    const data = buildClientData();
    data.assetTransactions = [
      {
        id: "tx-home-sale",
        name: "Sell primary home",
        type: "sell",
        year: 2040,
        accountId: "acct-home",
        qualifiesForHomeSaleExclusion: true,
      },
    ];
    const projection = runProjection(data);
    const events = detectTransactionEvents(data, projection);
    const sale = events.find((e) => e.id === "transaction:sell:tx-home-sale");
    expect(sale).toBeDefined();
    expect(sale!.year).toBe(2040);
    expect(sale!.subject).toBe("joint");
    expect(sale!.supportingFigure).toMatch(/\$/);
  });

  it("emits a purchase event for type=buy", () => {
    const data = buildClientData();
    data.assetTransactions = [
      {
        id: "tx-second-home",
        name: "Buy vacation home",
        type: "buy",
        year: 2045,
        assetName: "Vacation",
        assetCategory: "real_estate",
        purchasePrice: 500_000,
      },
    ];
    const projection = runProjection(data);
    const events = detectTransactionEvents(data, projection);
    const buy = events.find((e) => e.id === "transaction:buy:tx-second-home");
    expect(buy).toBeDefined();
    expect(buy!.year).toBe(2045);
  });

  it("emits transfer first-occurrence only", () => {
    const data = buildClientData();
    data.transfers = [
      {
        id: "xfer-1",
        name: "Brokerage → Savings",
        sourceAccountId: "acct-brokerage",
        targetAccountId: "acct-savings",
        amount: 20_000,
        mode: "recurring",
        startYear: 2028,
        endYear: 2032,
        growthRate: 0,
        schedules: [],
      },
    ];
    const projection = runProjection(data);
    const events = detectTransactionEvents(data, projection);
    const matches = events.filter((e) => e.id.startsWith("transaction:transfer:xfer-1"));
    expect(matches).toHaveLength(1);
    expect(matches[0].year).toBe(2028);
  });

  it("skips transactions outside projection window", () => {
    const data = buildClientData();
    data.assetTransactions = [
      {
        id: "tx-late",
        name: "Late sale",
        type: "sell",
        year: 2100,
      },
    ];
    const projection = runProjection(data);
    const events = detectTransactionEvents(data, projection);
    expect(events.find((e) => e.id === "transaction:sell:tx-late")).toBeUndefined();
  });
});
