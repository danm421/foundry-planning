import { describe, expect, it, vi, beforeEach } from "vitest";

const recordCreate = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (...a: unknown[]) => recordCreate(...a),
}));

const resolvePortalClient = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: (...a: unknown[]) => resolvePortalClient(...a),
}));
const requireEditEnabled = vi.fn();
vi.mock("@/lib/authz", () => ({
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

// Captured values from the last tx.insert(liabilities).values({...}) call.
let liabilityInsertValues: Record<string, unknown> | null = null;
// Spy on the liability insert (no .returning()).
const liabilityInsertMock = vi.fn().mockResolvedValue(undefined);
// Spy on the liability update (link-liability path). The .set() and .where()
// spies are captured so we can assert the link writes {plaidItemId,
// plaidAccountId} onto the correct existing liability id (tenant/identity).
const liabilityUpdateWhere = vi.fn().mockResolvedValue(undefined);
const liabilityUpdateSet = vi.fn().mockReturnValue({ where: liabilityUpdateWhere });
const liabilityUpdateMock = vi.fn().mockReturnValue({ set: liabilityUpdateSet });

const txInsertReturning = vi.fn();
// txInsert handles two cases:
//   1. tx.insert(accounts) → .values({}).returning() — classic accounts path.
//   2. tx.insert(liabilities) → .values({}) — no .returning(), just awaited directly.
// We track the last liability insert for assertion.
const txInsert = vi.fn().mockImplementation((table: unknown) => {
  // We identify the liabilities table by checking for a distinguishing property.
  // In Drizzle, table objects are distinct references; we check the Symbol or
  // use a sentinel. The simplest approach: peek at the table's SQL name via
  // the Drizzle internal symbol — but to stay harness-simple we just check
  // whether the table has a `liabilityType` column (duck-typed at runtime).
  const isLiabilities =
    table !== null &&
    typeof table === "object" &&
    "liabilityType" in (table as Record<string, unknown>);
  if (isLiabilities) {
    return {
      values: (vals: Record<string, unknown>) => {
        liabilityInsertValues = vals;
        liabilityInsertMock(vals);
        return Promise.resolve();
      },
    };
  }
  // accounts path (with .returning())
  return {
    values: vi.fn().mockReturnValue({ returning: txInsertReturning }),
  };
});

const txUpdateWhere = vi.fn().mockResolvedValue(undefined);
const txUpdate = vi.fn().mockImplementation((table: unknown) => {
  const isLiabilities =
    table !== null &&
    typeof table === "object" &&
    "liabilityType" in (table as Record<string, unknown>);
  if (isLiabilities) {
    return liabilityUpdateMock(table);
  }
  return {
    set: vi.fn().mockReturnValue({ where: txUpdateWhere }),
  };
});

// tx.select: used inside the transaction for the Plaid-key dedupe check
// (debt create path). Returns empty by default (no existing Plaid row).
let txSelectResp: unknown[] = [];
const txSelect = vi.fn().mockImplementation(() => ({
  from: () => ({
    where: () => ({
      limit: () => Promise.resolve(txSelectResp),
    }),
  }),
}));

const tx = { insert: txInsert, update: txUpdate, select: txSelect, delete: vi.fn() };
const dbTransaction = vi
  .fn()
  .mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));

vi.mock("@/db", () => ({
  db: { select: (...a: unknown[]) => dbSelect(...a), transaction: dbTransaction },
}));

beforeEach(() => {
  recordCreate.mockReset();
  resolvePortalClient.mockReset();
  requireEditEnabled.mockReset();
  dbSelect.mockReset();
  txInsertReturning.mockReset();
  txInsert.mockClear();
  txUpdate.mockClear();
  txUpdateWhere.mockClear();
  liabilityInsertValues = null;
  liabilityInsertMock.mockClear();
  liabilityUpdateMock.mockClear();
  liabilityUpdateSet.mockClear();
  liabilityUpdateWhere.mockClear();
  txSelect.mockClear();
  txSelectResp = [];

  resolvePortalClient.mockResolvedValue({ clientId: "client-1", mode: "client", clerkUserId: "user-1" });
  requireEditEnabled.mockResolvedValue(undefined);
  // Sequential dbSelect responses:
  //  1) item lookup
  //  2) firmId lookup
  //  3) scenario lookup (only if any "create" actions)
  //  4..N) per-link "existing account" or per-link-liability tenancy + plaid_item_id check
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

// Helper: build a POST Request for the commit route.
function commitReq(body: unknown): Request {
  return new Request("https://x/", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// Mutable row returned by the db.select() for link-liability pre-validation.
let existingLiabilityRow: { id: string; clientId: string; plaidItemId: string | null } | null = null;

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

describe("POST commit — Plaid debt → liabilities", () => {
  it("creates a held-flat credit_card liability from a Plaid credit account", async () => {
    // db.select sequence: item, firmId, scenario (create decision present), no link pre-checks.
    // tx.select: no existing Plaid row (empty) → goes to insert path.
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase" }],
      [{ firmId: "firm-1" }],
      [{ id: "s1" }], // base scenario
    );
    txSelectResp = []; // no existing Plaid-keyed liability → fresh insert
    txInsertReturning.mockResolvedValue([{ id: "new-acct-uuid" }]);

    const { POST } = await import("../route");
    const res = await POST(
      commitReq({
        itemId: "item-1",
        decisions: [
          {
            plaidAccountId: "plaid-cc",
            action: "create",
            accountData: {
              name: "Visa",
              mask: "1234",
              type: "credit",
              subtype: "credit card",
              balance: 5000,
            },
          },
        ],
      }),
    );
    expect(res.status).toBe(200);
    // A liabilities insert happened with the correct held-flat defaults.
    expect(liabilityInsertValues).toMatchObject({
      clientId: "client-1",
      scenarioId: "s1",
      name: "Visa",
      liabilityType: "credit_card",
      balance: "5000.00",
      plaidAccountId: "plaid-cc",
      interestRate: "0",
      monthlyPayment: null,
      termMonths: null,
      isInterestDeductible: false,
    });
    // No accounts insert for this row.
    expect(txInsert).toHaveBeenCalledTimes(1);
  });

  it("links a Plaid debt to an existing advisor liability (no new row)", async () => {
    existingLiabilityRow = { id: "liab-1", clientId: "client-1", plaidItemId: null };
    // db.select sequence: item, firmId, scenario, link-liability pre-check.
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase" }],
      [{ firmId: "firm-1" }],
      [{ id: "s1" }], // base scenario (scenario is always fetched)
      [existingLiabilityRow],                                  // link-liability pre-validation
    );

    const { POST } = await import("../route");
    const res = await POST(
      commitReq({
        itemId: "item-1",
        decisions: [
          { plaidAccountId: "plaid-mort", action: "link-liability", existingLiabilityId: "liab-1" },
        ],
      }),
    );
    expect(res.status).toBe(200);
    // An update was called (set plaidItemId/plaidAccountId on liab-1).
    expect(txUpdate).toHaveBeenCalled();
    // The link writes the Plaid keys (tenant/identity) onto the liability.
    expect(liabilityUpdateSet).toHaveBeenCalledWith({
      plaidItemId: "item-1", // == body.itemId
      plaidAccountId: "plaid-mort",
    });
    // ...and targets the correct existing liability id (liab-1) via the where.
    // drizzle eq() is real here; the id rides in a Param within queryChunks
    // (the SQL object is circular, so pull the param value out, don't stringify).
    expect(liabilityUpdateWhere).toHaveBeenCalledTimes(1);
    const whereArg = liabilityUpdateWhere.mock.calls[0][0] as {
      queryChunks?: { value?: unknown }[];
    };
    const paramValues = (whereArg.queryChunks ?? [])
      .map((c) => c?.value)
      .filter((v) => v !== undefined);
    expect(paramValues).toContain("liab-1");
    // No liability insert.
    expect(liabilityInsertMock).not.toHaveBeenCalled();
  });

  it("409s linking a liability already linked elsewhere", async () => {
    existingLiabilityRow = { id: "liab-1", clientId: "client-1", plaidItemId: "other-item" };
    nextResponses(
      [{ clientId: "client-1", institutionName: "Chase" }],
      [{ firmId: "firm-1" }],
      [{ id: "s1" }], // base scenario
      [existingLiabilityRow],                                  // link-liability pre-validation
    );

    const { POST } = await import("../route");
    const res = await POST(
      commitReq({
        itemId: "item-1",
        decisions: [
          { plaidAccountId: "plaid-mort", action: "link-liability", existingLiabilityId: "liab-1" },
        ],
      }),
    );
    expect(res.status).toBe(409);
  });
});
