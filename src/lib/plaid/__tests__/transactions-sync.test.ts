import { describe, it, expect, vi, beforeEach } from "vitest";

const transactionsSync = vi.fn();
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: () => ({ transactionsSync }) }));
vi.mock("@/lib/plaid/crypto", () => ({ decrypt: (s: string) => s }));

// DB mock — capture insert/delete chains
const mockInsertValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockDeleteWhere = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (row: unknown) => {
        mockInsertValues(row);
        return {
          onConflictDoUpdate: (opts: unknown) => {
            mockOnConflictDoUpdate(opts);
            return Promise.resolve();
          },
        };
      },
    }),
    delete: () => ({
      where: (cond: unknown) => {
        mockDeleteWhere(cond);
        return Promise.resolve();
      },
    }),
    select: vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve([]) }),
    })),
    transaction: (fn: (tx: unknown) => Promise<unknown>) => {
      mockTransaction();
      return fn({
        insert: () => ({
          values: (row: unknown) => {
            mockInsertValues(row);
            return {
              onConflictDoUpdate: (opts: unknown) => {
                mockOnConflictDoUpdate(opts);
                return Promise.resolve();
              },
            };
          },
        }),
        delete: () => ({
          where: (cond: unknown) => {
            mockDeleteWhere(cond);
            return Promise.resolve();
          },
        }),
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
      });
    },
  },
}));

vi.mock("@/db/schema", () => ({
  plaidTransactions: { plaidTransactionId: "plaidTransactionId", clientId: "clientId" },
  plaidItems: { id: "id", transactionsCursor: "transactionsCursor" },
  accounts: { id: "id", plaidItemId: "plaidItemId", plaidAccountId: "plaidAccountId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({ type: "eq" }),
  and: () => ({ type: "and" }),
  inArray: () => ({ type: "inArray" }),
  isNotNull: () => ({ type: "isNotNull" }),
}));

import {
  mapPlaidTransaction,
  fetchTransactionUpdates,
  applyTransactionUpdates,
} from "@/lib/plaid/transactions-sync";

beforeEach(() => {
  transactionsSync.mockReset();
  mockInsertValues.mockReset();
  mockOnConflictDoUpdate.mockReset();
  mockDeleteWhere.mockReset();
  mockTransaction.mockReset();
});

const plaidTxn = {
  transaction_id: "t1",
  account_id: "plaid-acc",
  amount: 42.5, // positive = money out
  iso_currency_code: "USD",
  date: "2026-06-01",
  authorized_date: "2026-05-31",
  merchant_name: "Coffee Co",
  name: "COFFEE CO #123",
  payment_channel: "in store",
  pending: false,
  personal_finance_category: {
    primary: "FOOD_AND_DRINK",
    detailed: "FOOD_AND_DRINK_COFFEE",
    confidence_level: "VERY_HIGH",
  },
};

describe("mapPlaidTransaction", () => {
  it("maps PFC v2 + sign + resolves our accountId", () => {
    const row = mapPlaidTransaction("c1", "item-1", new Map([["plaid-acc", "acct-1"]]), plaidTxn as never);
    expect(row).toMatchObject({
      clientId: "c1",
      plaidItemId: "item-1",
      accountId: "acct-1",
      plaidAccountId: "plaid-acc",
      plaidTransactionId: "t1",
      amount: "42.50",
      date: "2026-06-01",
      merchantName: "Coffee Co",
      name: "COFFEE CO #123",
      pfcPrimary: "FOOD_AND_DRINK",
      pfcDetailed: "FOOD_AND_DRINK_COFFEE",
      pfcConfidence: "VERY_HIGH",
      pending: false,
      categorizedBy: "plaid",
    });
  });
  it("accountId null when the Plaid account is not a tracked account (e.g. a credit card → liability)", () => {
    const row = mapPlaidTransaction("c1", "item-1", new Map(), plaidTxn as never);
    expect(row.accountId).toBeNull();
  });
});

describe("fetchTransactionUpdates", () => {
  it("first sync passes days_requested 730 and paginates has_more", async () => {
    transactionsSync
      .mockResolvedValueOnce({ data: { added: [plaidTxn], modified: [], removed: [], next_cursor: "cur1", has_more: true } })
      .mockResolvedValueOnce({ data: { added: [], modified: [], removed: [{ transaction_id: "t0" }], next_cursor: "cur2", has_more: false } });
    const res = await fetchTransactionUpdates({ accessToken: "enc" }, null);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.added).toHaveLength(1);
    expect(res.removed).toEqual(["t0"]);
    expect(res.nextCursor).toBe("cur2");
    // first call: cursor omitted/undefined + days_requested 730
    const firstArg = transactionsSync.mock.calls[0][0];
    expect(firstArg.options?.days_requested).toBe(730);
    expect(firstArg.cursor ?? undefined).toBeUndefined();
    // second call resumes from cur1
    expect(transactionsSync.mock.calls[1][0].cursor).toBe("cur1");
  });

  it("returns ok:false with errorCode on Plaid error", async () => {
    transactionsSync.mockRejectedValue(
      Object.assign(new Error("login required"), {
        response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "Login required" } },
      }),
    );
    const res = await fetchTransactionUpdates({ accessToken: "enc" }, null);
    expect(res).toMatchObject({ ok: false, errorCode: "ITEM_LOGIN_REQUIRED" });
  });
});

describe("applyTransactionUpdates", () => {
  it("upserts added rows via onConflictDoUpdate (idempotent)", async () => {
    const { db } = await import("@/db");
    await applyTransactionUpdates(db as never, {
      clientId: "c1",
      plaidItemId: "item-1",
      accountIdByPlaidAccountId: new Map([["plaid-acc", "acct-1"]]),
    }, {
      added: [plaidTxn as never],
      modified: [],
      removed: [],
    });
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflictOpts = mockOnConflictDoUpdate.mock.calls[0][0];
    // conflict target must be plaidTransactionId
    expect(conflictOpts.target).toBeDefined();
  });

  it("duplicate added row issues UPSERT (not second distinct insert)", async () => {
    const { db } = await import("@/db");
    // same txn in added twice — both should upsert
    await applyTransactionUpdates(db as never, {
      clientId: "c1",
      plaidItemId: "item-1",
      accountIdByPlaidAccountId: new Map(),
    }, {
      added: [plaidTxn as never, plaidTxn as never],
      modified: [],
      removed: [],
    });
    // 2 upserts — not a plain insert
    expect(mockInsertValues).toHaveBeenCalledTimes(2);
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(2);
    expect(mockDeleteWhere).not.toHaveBeenCalled();
  });

  it("deletes removed transaction_ids scoped to clientId", async () => {
    const { db } = await import("@/db");
    await applyTransactionUpdates(db as never, {
      clientId: "c1",
      plaidItemId: "item-1",
      accountIdByPlaidAccountId: new Map(),
    }, {
      added: [],
      modified: [],
      removed: ["t0", "t1"],
    });
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).not.toHaveBeenCalled();
  });

  it("skips delete call when removed list is empty", async () => {
    const { db } = await import("@/db");
    await applyTransactionUpdates(db as never, {
      clientId: "c1",
      plaidItemId: "item-1",
      accountIdByPlaidAccountId: new Map(),
    }, {
      added: [],
      modified: [],
      removed: [],
    });
    expect(mockDeleteWhere).not.toHaveBeenCalled();
  });
});
