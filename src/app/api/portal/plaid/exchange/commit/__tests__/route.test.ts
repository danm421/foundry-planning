import { describe, expect, it, vi, beforeEach } from "vitest";

const recordCreate = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (...a: unknown[]) => recordCreate(...a),
}));

const requireClientPortalAccess = vi.fn();
const requireEditEnabled = vi.fn();
vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: (...a: unknown[]) => requireClientPortalAccess(...a),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (...a: unknown[]) => requireEditEnabled(...a),
}));

// db mocks: itemRow lookup, candidate-existing-row lookups, insert, update, scenario lookup.
const dbSelect = vi.fn();
const txInsertReturning = vi.fn();
const txInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({ returning: txInsertReturning }),
});
const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
const txUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({ where: txUpdateWhere }),
});
const tx = { insert: txInsert, update: txUpdate, select: vi.fn(), delete: vi.fn() };
const dbTransaction = vi
  .fn()
  .mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));

vi.mock("@/db", () => ({
  db: { select: (...a: unknown[]) => dbSelect(...a), transaction: dbTransaction },
}));

beforeEach(() => {
  recordCreate.mockReset();
  requireClientPortalAccess.mockReset();
  requireEditEnabled.mockReset();
  dbSelect.mockReset();
  txInsertReturning.mockReset();
  txInsert.mockClear();
  txUpdate.mockClear();
  txUpdateWhere.mockClear();

  requireClientPortalAccess.mockResolvedValue({ clientId: "client-1", clerkUserId: "user-1" });
  requireEditEnabled.mockResolvedValue(undefined);
  // Sequential dbSelect responses:
  //  1) item lookup
  //  2) firmId lookup
  //  3) scenario lookup (only if any "create" actions)
  //  4..N) per-link "existing account" tenancy + plaid_item_id check
  dbSelect.mockImplementation(() => ({
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(currentResp()),
      }),
    }),
  }));
  // We'll override `currentResp` per test.
});

let currentResp: () => unknown[] = () => [];
function nextResponses(...responses: unknown[][]) {
  let i = 0;
  currentResp = () => responses[i++] ?? [];
}

describe("POST /api/portal/plaid/exchange/commit", () => {
  it("rejects when item doesn't belong to client", async () => {
    nextResponses([{ clientId: "OTHER", institutionName: "Chase" }]);
    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({
          itemId: "item-1",
          decisions: [{ plaidAccountId: "pa-1", action: "skip" }],
        }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("happy path: link + create + skip + audit", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase" }], // item
      [{ firmId: "firm-1" }],                                // firmId
      [{ id: "scenario-1" }],                                // base scenario
      [{ id: "manual-1", clientId: "client-1", plaidItemId: null }], // link target
    );
    txInsertReturning.mockResolvedValue([{ id: "new-acct-uuid" }]);

    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({
          itemId: "item-1",
          decisions: [
            { plaidAccountId: "pa-link", action: "link", existingAccountId: "manual-1" },
            {
              plaidAccountId: "pa-create",
              action: "create",
              accountData: {
                name: "Plaid Savings",
                mask: "1111",
                type: "depository",
                subtype: "savings",
                balance: 50000,
              },
            },
            { plaidAccountId: "pa-skip", action: "skip" },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.linkedAccountIds).toHaveLength(2); // manual-1 + new-acct-uuid
    expect(recordCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.plaid.link",
        snapshot: {
          institutionName: "Chase",
          linkedCount: 1,
          addedCount: 1,
          skippedCount: 1,
        },
      }),
    );
    expect(txUpdate).toHaveBeenCalled(); // link update on existing row
    expect(txInsert).toHaveBeenCalled(); // create insert
  });

  it("rejects when link target already has a plaidItemId", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase" }],
      [{ firmId: "firm-1" }],
      [{ id: "scenario-1" }],
      [{ id: "manual-1", clientId: "client-1", plaidItemId: "OTHER-item" }],
    );
    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({
          itemId: "item-1",
          decisions: [
            { plaidAccountId: "pa-1", action: "link", existingAccountId: "manual-1" },
          ],
        }),
      }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects when link target account belongs to a different client", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase" }], // item — passes tenant check
      [{ firmId: "firm-1" }],                                // firmId
      [{ id: "scenario-1" }],                                // base scenario
      [{ id: "manual-other", clientId: "other-client", plaidItemId: null }], // cross-client account
    );
    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({
          itemId: "item-1",
          decisions: [
            { plaidAccountId: "pa-1", action: "link", existingAccountId: "manual-other" },
          ],
        }),
      }),
    );
    expect(res.status).toBe(404);
    expect(txUpdate).not.toHaveBeenCalled();
    expect(txInsert).not.toHaveBeenCalled();
    expect(recordCreate).not.toHaveBeenCalled();
  });
});
