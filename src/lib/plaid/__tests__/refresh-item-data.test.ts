import { describe, it, expect, vi, beforeEach } from "vitest";
import { accounts, liabilities, plaidItems } from "@/db/schema";

// --- Plaid product stubs (mocked; the write path under test forwards to them) ---
const fetchBalancesForItem = vi.fn();
vi.mock("../refresh", () => ({
  fetchBalancesForItem: (...a: unknown[]) => fetchBalancesForItem(...a),
}));

const fetchLiabilitiesForItem = vi.fn();
vi.mock("../liabilities-refresh", () => ({
  fetchLiabilitiesForItem: (...a: unknown[]) => fetchLiabilitiesForItem(...a),
}));

type HoldingsMockResult =
  | { ok: true; holdings: Array<{ plaidAccountId: string; securityId: string; quantity: string; costBasis: string }> }
  | { ok: false; errorCode: string; errorMessage: string };
const fetchInvestmentHoldingsForItem = vi.fn<(...a: unknown[]) => Promise<HoldingsMockResult>>();
vi.mock("../holdings-refresh", () => ({
  fetchInvestmentHoldingsForItem: (...a: unknown[]) => fetchInvestmentHoldingsForItem(...a),
}));

const ingestHoldingsForItem = vi.fn<(...a: unknown[]) => Promise<{ accountsUpdated: number; holdingsWritten: number }>>(
  async () => ({ accountsUpdated: 1, holdingsWritten: 1 }),
);
vi.mock("../ingest-holdings", () => ({
  ingestHoldingsForItem: (...a: unknown[]) => ingestHoldingsForItem(...a),
}));

// --- db mock: capture top-level + tx update calls ---
type UpdateCall = { table: unknown; setArg: unknown; whereArgs: unknown[] };
const updateCalls: UpdateCall[] = [];
const txUpdateCalls: UpdateCall[] = [];

const dbSelect = vi.fn();

const dbUpdate = vi.fn().mockImplementation((table: unknown) => ({
  set: (setArg: unknown) => ({
    where: (...whereArgs: unknown[]) => {
      updateCalls.push({ table, setArg, whereArgs });
      return Promise.resolve();
    },
  }),
}));

const tx = {
  update: vi.fn().mockImplementation((table: unknown) => ({
    set: (setArg: unknown) => ({
      where: (...whereArgs: unknown[]) => {
        txUpdateCalls.push({ table, setArg, whereArgs });
        return Promise.resolve();
      },
    }),
  })),
};
const dbTransaction = vi
  .fn()
  .mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));

vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    transaction: dbTransaction,
    update: (...a: unknown[]) => dbUpdate(...a),
  },
}));

// The lib does exactly one db.select: the linked accounts for this item.
let linkedAccounts: unknown[] = [];
beforeEach(() => {
  updateCalls.length = 0;
  txUpdateCalls.length = 0;
  fetchBalancesForItem.mockReset();
  fetchLiabilitiesForItem.mockReset();
  fetchInvestmentHoldingsForItem.mockReset();
  ingestHoldingsForItem.mockClear();
  dbUpdate.mockClear();
  tx.update.mockClear();
  dbTransaction.mockClear();

  linkedAccounts = [{ id: "acct-1", plaidAccountId: "pa1", value: "1000.00" }];
  dbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(linkedAccounts),
      }),
    }),
  }));

  // Defaults: everything succeeds (individual tests override).
  fetchBalancesForItem.mockResolvedValue({
    ok: true,
    updates: [{ plaidAccountId: "pa1", newValue: "1010.00" }],
  });
  fetchLiabilitiesForItem.mockResolvedValue({ ok: true, updates: [] });
  fetchInvestmentHoldingsForItem.mockResolvedValue({
    ok: true,
    holdings: [{ plaidAccountId: "pa1", securityId: "sec-1", quantity: "10", costBasis: "500.00" }],
  });
  ingestHoldingsForItem.mockResolvedValue({ accountsUpdated: 1, holdingsWritten: 1 });
});

describe("refreshPlaidItemData", () => {
  it("success: applies balance updates, stamps lastRefreshedAt, clears lastRefreshError", async () => {
    linkedAccounts = [
      { id: "acct-1", plaidAccountId: "pa1", value: "100.00" },
      { id: "acct-2", plaidAccountId: "pa2", value: "200.00" },
    ];
    fetchBalancesForItem.mockResolvedValue({
      ok: true,
      updates: [
        { plaidAccountId: "pa1", newValue: "150.00" },
        { plaidAccountId: "pa2", newValue: "250.00" },
      ],
    });

    const { refreshPlaidItemData } = await import("../refresh-item-data");
    const result = await refreshPlaidItemData({ id: "item-1", accessToken: "enc" });

    expect(result).toEqual({
      ok: true,
      accountsRefreshed: 2,
      beforeTotal: "300.00",
      afterTotal: "400.00",
    });

    // Balance updates applied inside the transaction, one per account.
    const acctUpdates = txUpdateCalls.filter((c) => c.table === accounts);
    expect(acctUpdates).toHaveLength(2);
    expect(acctUpdates.map((c) => c.setArg)).toEqual([
      { value: "150.00" },
      { value: "250.00" },
    ]);

    // plaidItems stamped with a fresh timestamp + cleared error, in the txn.
    const itemUpdate = txUpdateCalls.find((c) => c.table === plaidItems);
    expect(itemUpdate).toBeDefined();
    const setArg = itemUpdate!.setArg as { lastRefreshedAt: Date; lastRefreshError: null };
    expect(setArg.lastRefreshedAt).toBeInstanceOf(Date);
    expect(setArg.lastRefreshError).toBeNull();
  });

  it("failure: persists the error code and returns needsReauth for ITEM_LOGIN_REQUIRED", async () => {
    fetchBalancesForItem.mockResolvedValue({
      ok: false,
      errorCode: "ITEM_LOGIN_REQUIRED",
      errorMessage: "re-auth",
    });

    const { refreshPlaidItemData } = await import("../refresh-item-data");
    const result = await refreshPlaidItemData({ id: "item-1", accessToken: "enc" });

    expect(result).toEqual({
      ok: false,
      errorCode: "ITEM_LOGIN_REQUIRED",
      needsReauth: true,
    });

    // The error CODE is persisted to last_refresh_error on the item row.
    const errWrite = updateCalls.find((c) => c.table === plaidItems);
    expect(errWrite).toBeDefined();
    expect(errWrite!.setArg).toEqual({ lastRefreshError: "ITEM_LOGIN_REQUIRED" });

    // No balance transaction ran on the failure path.
    expect(dbTransaction).not.toHaveBeenCalled();
  });

  it("liabilities: writes Plaid metadata alongside the balance refresh", async () => {
    fetchLiabilitiesForItem.mockResolvedValue({
      ok: true,
      updates: [
        {
          plaidAccountId: "pa1",
          balance: "1010.00",
          statementBalance: "990.00",
          minimumPayment: "40.00",
          aprPercentage: "22.0000",
          nextPaymentDueDate: "2026-08-01",
        },
      ],
    });

    const { refreshPlaidItemData } = await import("../refresh-item-data");
    const result = await refreshPlaidItemData({ id: "item-1", accessToken: "enc" });

    expect(result.ok).toBe(true);
    const liabUpdates = updateCalls.filter((c) => c.table === liabilities);
    expect(liabUpdates).toHaveLength(1);
    expect(liabUpdates[0].setArg).toEqual({
      balance: "1010.00",
      statementBalance: "990.00",
      minimumPayment: "40.00",
      aprPercentage: "22.0000",
      nextPaymentDueDate: "2026-08-01",
    });
  });

  it("liabilities error does not fail the refresh (balance updates already committed)", async () => {
    fetchLiabilitiesForItem.mockRejectedValue(new Error("Item lacks Liabilities product"));

    const { refreshPlaidItemData } = await import("../refresh-item-data");
    const result = await refreshPlaidItemData({ id: "item-1", accessToken: "enc" });

    expect(result.ok).toBe(true);
    // Balance write still happened despite the liabilities failure.
    expect(txUpdateCalls.some((c) => c.table === accounts)).toBe(true);
  });

  it("holdings: ingests fetched holdings with the item row id", async () => {
    const { refreshPlaidItemData } = await import("../refresh-item-data");
    const result = await refreshPlaidItemData({ id: "item-row-1", accessToken: "enc" });

    expect(result.ok).toBe(true);
    expect(fetchInvestmentHoldingsForItem).toHaveBeenCalledWith(
      { accessToken: "enc" },
      ["pa1"],
    );
    expect(ingestHoldingsForItem).toHaveBeenCalledWith(
      "item-row-1",
      [{ plaidAccountId: "pa1", securityId: "sec-1", quantity: "10", costBasis: "500.00" }],
    );
  });

  it("holdings error does not fail the refresh; no ingest happens", async () => {
    fetchInvestmentHoldingsForItem.mockResolvedValue({
      ok: false,
      errorCode: "PRODUCTS_NOT_SUPPORTED",
      errorMessage: "Item does not support Investments product",
    });

    const { refreshPlaidItemData } = await import("../refresh-item-data");
    const result = await refreshPlaidItemData({ id: "item-1", accessToken: "enc" });

    expect(result.ok).toBe(true);
    expect(ingestHoldingsForItem).not.toHaveBeenCalled();
  });
});
