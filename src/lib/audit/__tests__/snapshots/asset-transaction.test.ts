// src/lib/audit/__tests__/snapshots/asset-transaction.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(),
  },
}));

import { db } from "@/db";
import { assetTransactions } from "@/db/schema";
import { toAssetTransactionSnapshot } from "../../snapshots/asset-transaction";

const buyRow: typeof assetTransactions.$inferSelect = {
  id: "tx1",
  clientId: "cli1",
  scenarioId: "scn1",
  name: "Buy condo",
  type: "buy",
  year: 2030,
  accountId: null,
  overrideSaleValue: null,
  overrideBasis: null,
  transactionCostPct: null,
  transactionCostFlat: null,
  proceedsAccountId: null,
  qualifiesForHomeSaleExclusion: false,
  purchaseTransactionId: null,
  fractionSold: null,
  assetName: "Florida condo",
  assetCategory: "real_estate",
  assetSubType: "primary_residence",
  purchasePrice: "500000.00",
  growthRate: "0.04",
  growthSource: "default",
  modelPortfolioId: null,
  basis: null,
  fundingAccountId: null,
  mortgageAmount: "300000.00",
  mortgageRate: "0.065",
  mortgageTermMonths: 360,
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.mocked(db.select).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([]),
    }),
  } as never);
});

describe("toAssetTransactionSnapshot", () => {
  it("returns the buy fields with numbers", async () => {
    const snap = await toAssetTransactionSnapshot(buyRow);
    expect(snap.type).toBe("buy");
    expect(snap.assetName).toBe("Florida condo");
    expect(snap.purchasePrice).toBe(500000);
    expect(snap.mortgageAmount).toBe(300000);
    expect(snap.mortgageRate).toBe(0.065);
  });

  it("hydrates fundingAccountId to a reference", async () => {
    vi.mocked(db.select).mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([
          { id: "acc1", name: "Joint Brokerage" },
        ]),
      }),
    } as never);

    const snap = await toAssetTransactionSnapshot({
      ...buyRow,
      fundingAccountId: "acc1",
    });

    expect(snap.fundingAccount).toEqual({ id: "acc1", display: "Joint Brokerage" });
  });

  it("includes both buy and sale-side fields with nulls preserved", async () => {
    const snap = await toAssetTransactionSnapshot(buyRow);
    expect(snap.account).toBeNull();
    expect(snap.proceedsAccount).toBeNull();
    expect(snap.overrideSaleValue).toBeNull();
  });
});
