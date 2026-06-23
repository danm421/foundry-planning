import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";
import { liabilities } from "@/db/schema";

// Track top-level db.update().set().where() calls (outside the tx)
const updateCalls: unknown[] = [];

vi.mock("@/lib/plaid/liabilities-refresh", () => ({
  fetchLiabilitiesForItem: vi.fn(async () => ({
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
  })),
}));

vi.mock("@/lib/plaid/refresh", () => ({
  fetchBalancesForItem: vi.fn(async () => ({
    ok: true,
    updates: [{ plaidAccountId: "pa1", newValue: "1010.00" }],
  })),
}));

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
vi.mock("@/lib/authz", () => ({
  authErrorResponse: () => null,
}));

vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));

vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: vi.fn(async () => undefined),
}));

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

// Top-level db.update: track calls into updateCalls (used by both plaidItems error-write AND liability updates)
const dbUpdate = vi.fn().mockImplementation((...args: unknown[]) => ({
  set: vi.fn().mockReturnValue({
    where: (...a: unknown[]) => {
      updateCalls.push({ table: args[0], whereArgs: a });
      return Promise.resolve();
    },
  }),
}));

// Three selects in order: item row, linked accounts, client firmId
let selectCallIdx = 0;
const selectResponses = [
  [{ clientId: "client-1", institutionName: "Chase", accessToken: "enc:x", plaidItemId: "plaid-x" }],
  [{ id: "acct-1", plaidAccountId: "pa1", value: "1000.00" }],
  [{ firmId: "firm-1" }],
];

vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    transaction: dbTransaction,
    update: (...a: unknown[]) => dbUpdate(...a),
  },
}));

beforeEach(() => {
  updateCalls.length = 0;
  selectCallIdx = 0;
  recordCreate.mockReset();
  dbSelect.mockReset();
  dbUpdate.mockClear();
  tx.update.mockClear();
  txUpdateWhere.mockClear();

  dbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(selectResponses[selectCallIdx++] ?? []),
      }),
    }),
  }));
});

describe("portal plaid refresh — liabilities", () => {
  it("updates matching liabilities with Plaid metadata alongside balance refresh", async () => {
    const { POST } = await import("../refresh/route");
    const res = await POST(new Request("http://x", { method: "POST" }), {
      params: Promise.resolve({ id: "item-1" }),
    });
    expect(res.status).toBe(200);
    // Assert exactly one top-level db.update(liabilities) call happened.
    // The mock fixture has 1 Plaid liability update; plaidItems error-write
    // only fires on refresh failure (not this happy-path case).
    const liabUpdates = (updateCalls as { table: unknown; whereArgs: unknown[] }[]).filter(
      (c) => c.table === liabilities,
    );
    expect(liabUpdates).toHaveLength(1);
  });
});
