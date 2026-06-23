import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// Plaid balance + liabilities stubs (required by route, not under test here)
vi.mock("@/lib/plaid/refresh", () => ({
  fetchBalancesForItem: vi.fn(async () => ({
    ok: true,
    updates: [{ plaidAccountId: "pa1", newValue: "1010.00" }],
  })),
}));
vi.mock("@/lib/plaid/liabilities-refresh", () => ({
  fetchLiabilitiesForItem: vi.fn(async () => ({ ok: true, updates: [] })),
}));

// Holdings mocks — hoisted so tests can re-configure per-case
const fetchInvestmentHoldingsForItem = vi.fn(async () => ({
  ok: true,
  holdings: [{ plaidAccountId: "pa1", securityId: "sec-1", quantity: "10", costBasis: "500.00" }],
}));
const ingestHoldingsForItem = vi.fn(async () => ({ accountsUpdated: 1, holdingsWritten: 1 }));
vi.mock("@/lib/plaid/holdings-refresh", () => ({ fetchInvestmentHoldingsForItem }));
vi.mock("@/lib/plaid/ingest-holdings", () => ({ ingestHoldingsForItem }));

const recordCreate = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (...a: unknown[]) => recordCreate(...a),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkPortalPlaidRefreshRateLimit: vi.fn(async () => ({ allowed: true })),
  rateLimitErrorResponse: (_rl: unknown, msg: string) =>
    NextResponse.json({ error: msg }, { status: 429 }),
}));

vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: vi.fn(async () => ({
    clientId: "client-1",
    mode: "client",
    clerkUserId: "user-1",
  })),
}));

vi.mock("@/lib/authz", () => ({ authErrorResponse: () => null }));

vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));

vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: vi.fn(async () => undefined),
}));

// DB mock — three selects in order: item row, linked accounts, client firmId
const dbSelect = vi.fn();
const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
const tx = {
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockReturnValue({ where: txUpdateWhere }),
  }),
};
const dbTransaction = vi
  .fn()
  .mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));
const dbUpdate = vi.fn().mockImplementation(() => ({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    transaction: dbTransaction,
    update: (...a: unknown[]) => dbUpdate(...a),
  },
}));

const SELECT_RESPONSES = [
  // item row
  [{ clientId: "client-1", institutionName: "Chase", accessToken: "enc:x", plaidItemId: "plaid-x" }],
  // linked accounts
  [{ id: "acct-1", plaidAccountId: "pa1", value: "1000.00" }],
  // client firmId
  [{ firmId: "firm-1" }],
];

beforeEach(() => {
  vi.clearAllMocks();

  // Reset ingest mock back to default success after each test
  ingestHoldingsForItem.mockResolvedValue({ accountsUpdated: 1, holdingsWritten: 1 });
  fetchInvestmentHoldingsForItem.mockResolvedValue({
    ok: true,
    holdings: [{ plaidAccountId: "pa1", securityId: "sec-1", quantity: "10", costBasis: "500.00" }],
  });

  let selectCallIdx = 0;
  dbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(SELECT_RESPONSES[selectCallIdx++] ?? []),
      }),
    }),
  }));

  dbUpdate.mockImplementation(() => ({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(undefined),
    }),
  }));

  txUpdateWhere.mockResolvedValue(undefined);
  tx.update.mockReturnValue({
    set: vi.fn().mockReturnValue({ where: txUpdateWhere }),
  });
  dbTransaction.mockImplementation(
    async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
  );
  recordCreate.mockResolvedValue(undefined);
});

describe("refresh route — holdings ingestion", () => {
  it("calls ingestHoldingsForItem with the item row id and fetched holdings", async () => {
    const { POST } = await import("../refresh/route");
    const res = await POST(new Request("http://x", { method: "POST" }), {
      params: Promise.resolve({ id: "item-row-1" }),
    });
    expect(res.status).toBe(200);
    expect(fetchInvestmentHoldingsForItem).toHaveBeenCalledWith(
      { accessToken: "enc:x" },
      ["pa1"],
    );
    expect(ingestHoldingsForItem).toHaveBeenCalledWith(
      "item-row-1",
      [{ plaidAccountId: "pa1", securityId: "sec-1", quantity: "10", costBasis: "500.00" }],
    );
  });

  it("does not throw and returns 200 when the holdings fetch fails", async () => {
    fetchInvestmentHoldingsForItem.mockResolvedValueOnce({
      ok: false,
      errorCode: "PRODUCTS_NOT_SUPPORTED",
      errorMessage: "Item does not support Investments product",
    });
    const { POST } = await import("../refresh/route");
    const res = await POST(new Request("http://x", { method: "POST" }), {
      params: Promise.resolve({ id: "item-row-1" }),
    });
    expect(res.status).toBe(200);
    expect(ingestHoldingsForItem).not.toHaveBeenCalled();
  });
});
