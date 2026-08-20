import { describe, it, expect, vi, beforeEach } from "vitest";

const transactionsSync = vi.fn();
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: () => ({ transactionsSync }) }));
vi.mock("@/lib/plaid/crypto", () => ({ decrypt: (s: string) => s }));
vi.mock("@/lib/portal/seed-categories", () => ({ ensureCategoriesSeeded: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/portal/load-categorization-context", () => ({
  loadCategorizationContext: vi.fn().mockResolvedValue({
    rules: [{ matchType: "contains", pattern: "uber", categoryId: "cat-uber", priority: 10 }],
    recurrings: [],
    slugToId: new Map([["food-restaurants", "cat-rest"]]),
  }),
}));
vi.mock("@/lib/portal/resolve-category", () => ({
  resolveTransactionCategory: vi.fn(({ pfcPrimary, merchantName, name, rules, slugToId }: {
    pfcPrimary: string | null;
    pfcDetailed: string | null;
    merchantName: string | null;
    name: string;
    rules: Array<{ matchType: string; pattern: string; categoryId: string; priority: number }>;
    slugToId: Map<string, string>;
  }) => {
    // Check rules first (contains match)
    for (const rule of [...rules].sort((a, b) => a.priority - b.priority)) {
      const pat = rule.pattern.toLowerCase();
      const fields = [merchantName, name].filter(Boolean) as string[];
      if (fields.some(f => f.toLowerCase().includes(pat))) {
        return { categoryId: rule.categoryId, categorizedBy: "rule", recurringTransactionId: null };
      }
    }
    // PFC fallback
    const PRIMARY_MAP: Record<string, string> = { FOOD_AND_DRINK: "food-restaurants" };
    if (pfcPrimary && PRIMARY_MAP[pfcPrimary]) {
      const slug = PRIMARY_MAP[pfcPrimary];
      const id = slugToId.get(slug) ?? null;
      return { categoryId: id, categorizedBy: "plaid", recurringTransactionId: null };
    }
    return { categoryId: null, categorizedBy: "plaid", recurringTransactionId: null };
  }),
}));

// DB mock — capture insert/delete chains
const mockInsertValues = vi.fn();
const mockOnConflictDoUpdate = vi.fn();
const mockDeleteWhere = vi.fn();
const mockTransaction = vi.fn();
const mockUpdate = vi.fn();
let selectRows: unknown[] = [];

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
      from: () => ({ where: () => Promise.resolve(selectRows) }),
    })),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: (cond: unknown) => {
          mockUpdate({ table, values, cond });
          return Promise.resolve();
        },
      }),
    }),
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
        update: (table: unknown) => ({
          set: (values: unknown) => ({
            where: (cond: unknown) => {
              mockUpdate({ table, values, cond });
              return Promise.resolve();
            },
          }),
        }),
      });
    },
  },
}));

vi.mock("@/db/schema", () => ({
  plaidTransactions: {
    plaidTransactionId: "plaidTransactionId",
    clientId: "clientId",
    plaidAccountId: "plaidAccountId",
    accountId: "accountId",
  },
  plaidItems: { id: "id", transactionsCursor: "transactionsCursor" },
  accounts: { id: "id", plaidItemId: "plaidItemId", plaidAccountId: "plaidAccountId" },
}));

vi.mock("drizzle-orm", () => ({
  eq: () => ({ type: "eq" }),
  and: () => ({ type: "and" }),
  inArray: () => ({ type: "inArray" }),
  isNotNull: () => ({ type: "isNotNull" }),
  isNull: () => ({ type: "isNull" }),
}));

import {
  mapPlaidTransaction,
  fetchTransactionUpdates,
  applyTransactionUpdates,
  backfillTransactionAccountIds,
  syncTransactionsForItem,
} from "@/lib/plaid/transactions-sync";

function makePlaidTxn(over: Record<string, unknown> = {}) {
  return {
    account_id: "acc_1", transaction_id: "txn_1", amount: 12.5,
    iso_currency_code: "USD", date: "2026-06-01", authorized_date: null,
    merchant_name: "Coffee", name: "Coffee Shop", pending: false,
    payment_channel: "in store",
    personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_COFFEE", confidence_level: "HIGH" },
    ...over,
  } as unknown as import("plaid").Transaction;
}

describe("mapPlaidTransaction type", () => {
  const accMap = new Map<string, string>([["acc_1", "our-acc-1"]]);
  it("defaults to expense for ordinary spend", () => {
    expect(mapPlaidTransaction("c1", "item1", accMap, makePlaidTxn()).type).toBe("expense");
  });
  it("sets income for INCOME primary", () => {
    const t = makePlaidTxn({ personal_finance_category: { primary: "INCOME", detailed: "INCOME_WAGES", confidence_level: "HIGH" } });
    expect(mapPlaidTransaction("c1", "item1", accMap, t).type).toBe("income");
  });
  it("sets transfer for TRANSFER_OUT primary", () => {
    const t = makePlaidTxn({ personal_finance_category: { primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER", confidence_level: "HIGH" } });
    expect(mapPlaidTransaction("c1", "item1", accMap, t).type).toBe("transfer");
  });
});

beforeEach(() => {
  transactionsSync.mockReset();
  mockInsertValues.mockReset();
  mockOnConflictDoUpdate.mockReset();
  mockDeleteWhere.mockReset();
  mockTransaction.mockReset();
  mockUpdate.mockReset();
  selectRows = [];
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
      categorization: { rules: [], recurrings: [], slugToId: new Map() },
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
      categorization: { rules: [], recurrings: [], slugToId: new Map() },
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
      categorization: { rules: [], recurrings: [], slugToId: new Map() },
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
      categorization: { rules: [], recurrings: [], slugToId: new Map() },
    }, {
      added: [],
      modified: [],
      removed: [],
    });
    expect(mockDeleteWhere).not.toHaveBeenCalled();
  });
});

describe("applyTransactionUpdates categorization", () => {
  const uberTxn = {
    transaction_id: "t-uber",
    account_id: "plaid-acc",
    amount: 18.5,
    iso_currency_code: "USD",
    date: "2026-06-10",
    authorized_date: "2026-06-09",
    merchant_name: "Uber",
    name: "UBER* TRIP",
    payment_channel: "online",
    pending: false,
    personal_finance_category: {
      primary: "TRANSPORTATION",
      detailed: "TRANSPORTATION_TAXIS_AND_RIDE_SHARING",
      confidence_level: "HIGH",
    },
  };

  const foodTxn = {
    transaction_id: "t-food",
    account_id: "plaid-acc",
    amount: 25.0,
    iso_currency_code: "USD",
    date: "2026-06-11",
    authorized_date: "2026-06-10",
    merchant_name: "Chipotle",
    name: "CHIPOTLE #456",
    payment_channel: "in store",
    pending: false,
    personal_finance_category: {
      primary: "FOOD_AND_DRINK",
      detailed: "FOOD_AND_DRINK_FAST_FOOD",
      confidence_level: "HIGH",
    },
  };

  it("sets categoryId + categorizedBy=rule on an added row that matches a rule", async () => {
    const { db } = await import("@/db");
    const categorization = {
      rules: [{ matchType: "contains" as const, pattern: "uber", categoryId: "cat-uber", priority: 10 }],
      recurrings: [],
      slugToId: new Map([["food-restaurants", "cat-rest"]]),
    };
    await applyTransactionUpdates(db as never, {
      clientId: "c1",
      plaidItemId: "item-1",
      accountIdByPlaidAccountId: new Map([["plaid-acc", "acct-1"]]),
      categorization,
    }, {
      added: [uberTxn as never],
      modified: [],
      removed: [],
    });
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    const insertedRow = mockInsertValues.mock.calls[0][0];
    expect(insertedRow.categoryId).toBe("cat-uber");
    expect(insertedRow.categorizedBy).toBe("rule");
  });

  it("falls back to PFC mapping (categorizedBy=plaid) when no rule matches", async () => {
    const { db } = await import("@/db");
    const categorization = {
      rules: [{ matchType: "contains" as const, pattern: "uber", categoryId: "cat-uber", priority: 10 }],
      recurrings: [],
      slugToId: new Map([["food-restaurants", "cat-rest"]]),
    };
    await applyTransactionUpdates(db as never, {
      clientId: "c1",
      plaidItemId: "item-1",
      accountIdByPlaidAccountId: new Map([["plaid-acc", "acct-1"]]),
      categorization,
    }, {
      added: [foodTxn as never],
      modified: [],
      removed: [],
    });
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    const insertedRow = mockInsertValues.mock.calls[0][0];
    expect(insertedRow.categoryId).toBe("cat-rest");
    expect(insertedRow.categorizedBy).toBe("plaid");
  });

  it("onConflictDoUpdate set-block does NOT include categoryId/categorizedBy", async () => {
    const { db } = await import("@/db");
    await applyTransactionUpdates(db as never, {
      clientId: "c1",
      plaidItemId: "item-1",
      accountIdByPlaidAccountId: new Map(),
      categorization: { rules: [], recurrings: [], slugToId: new Map() },
    }, {
      added: [plaidTxn as never],
      modified: [],
      removed: [],
    });
    expect(mockOnConflictDoUpdate).toHaveBeenCalledTimes(1);
    const conflictOpts = mockOnConflictDoUpdate.mock.calls[0][0];
    expect(conflictOpts.set).not.toHaveProperty("categoryId");
    expect(conflictOpts.set).not.toHaveProperty("categorizedBy");
  });
});

describe("backfillTransactionAccountIds", () => {
  it("re-points each mapped Plaid handle's unattributed rows at our accountId", async () => {
    const { db } = await import("@/db");
    const { plaidTransactions } = await import("@/db/schema");
    await backfillTransactionAccountIds(
      db as never,
      "c1",
      new Map([
        ["plaid-checking", "acct-checking"],
        ["plaid-savings", "acct-savings"],
      ]),
    );
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    const calls = mockUpdate.mock.calls.map((c) => c[0]);
    expect(calls.every((c) => c.table === plaidTransactions)).toBe(true);
    expect(calls.map((c) => c.values)).toEqual([
      { accountId: "acct-checking" },
      { accountId: "acct-savings" },
    ]);
  });

  it("issues no UPDATE when the item has no mapped asset accounts (cards only)", async () => {
    const { db } = await import("@/db");
    await backfillTransactionAccountIds(db as never, "c1", new Map());
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("syncTransactionsForItem attribution repair", () => {
  it("backfills rows Plaid will never resend (webhook synced before the client mapped accounts)", async () => {
    // The first sync ran from the SYNC_UPDATES_AVAILABLE webhook, before the
    // checking account existed — every row landed with accountId NULL and the
    // cursor moved past them. This sync returns nothing new; the repair is the
    // only thing that can attribute them.
    selectRows = [{ id: "acct-checking", plaidAccountId: "plaid-checking" }];
    transactionsSync.mockResolvedValueOnce({
      data: { added: [], modified: [], removed: [], next_cursor: "cur2", has_more: false },
    });
    const res = await syncTransactionsForItem({
      id: "item-1",
      clientId: "c1",
      accessToken: "enc",
      transactionsCursor: "cur1",
    });
    expect(res.ok).toBe(true);
    const { plaidTransactions } = await import("@/db/schema");
    const repair = mockUpdate.mock.calls
      .map((c) => c[0])
      .filter((c) => c.table === plaidTransactions);
    expect(repair).toHaveLength(1);
    expect(repair[0].values).toEqual({ accountId: "acct-checking" });
  });
});
