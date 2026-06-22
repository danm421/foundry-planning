import { describe, expect, it, vi, beforeEach } from "vitest";

const itemPublicTokenExchange = vi.fn();
const accountsGet = vi.fn();
vi.mock("@/lib/plaid/client", () => ({
  getPlaidClient: () => ({ itemPublicTokenExchange, accountsGet }),
}));
vi.mock("@/lib/plaid/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
}));

const resolvePortalClient = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: (...args: unknown[]) => resolvePortalClient(...args),
}));
const requireEditEnabled = vi.fn();
vi.mock("@/lib/authz", () => ({
  authErrorResponse: () => null,
}));
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (...args: unknown[]) => requireEditEnabled(...args),
}));

const insertedItem = { id: "item-uuid-1" };
const insertReturning = vi.fn().mockResolvedValue([insertedItem]);
const dbInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockReturnValue({ returning: insertReturning }),
});
const dbSelect = vi.fn();
vi.mock("@/db", () => ({
  db: { insert: (...args: unknown[]) => dbInsert(...args), select: (...args: unknown[]) => dbSelect(...args) },
}));

beforeEach(() => {
  itemPublicTokenExchange.mockReset();
  accountsGet.mockReset();
  resolvePortalClient.mockReset();
  requireEditEnabled.mockReset();
  insertReturning.mockClear();
  dbInsert.mockClear();
  dbSelect.mockReset();

  resolvePortalClient.mockResolvedValue({
    clientId: "client-1",
    mode: "client",
    clerkUserId: "user-1",
  });
  requireEditEnabled.mockResolvedValue(undefined);
  itemPublicTokenExchange.mockResolvedValue({
    data: { access_token: "access-sandbox-x", item_id: "plaid-item-x" },
  });
  accountsGet.mockResolvedValue({
    data: {
      accounts: [
        {
          account_id: "pa-1",
          name: "Plaid Checking",
          official_name: "Plaid Gold Standard 0% Interest Checking",
          mask: "0000",
          type: "depository",
          subtype: "checking",
          balances: { current: 4231.07 },
        },
      ],
    },
  });
  // existing-manual-accounts query
  dbSelect.mockReturnValue({
    from: () => ({
      where: () => ({
        orderBy: () =>
          Promise.resolve([
            { id: "manual-1", name: "Old Checking", category: "cash", subType: "checking" },
          ]),
      }),
    }),
  });
});

describe("POST /api/portal/plaid/exchange", () => {
  it("persists plaid_items and returns picker payload on happy path", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", {
        method: "POST",
        body: JSON.stringify({
          publicToken: "public-sandbox-1",
          institution: { id: "ins_1", name: "Chase" },
        }),
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.itemId).toBe("item-uuid-1");
    expect(json.accounts).toHaveLength(1);
    expect(json.accounts[0]).toMatchObject({
      plaidAccountId: "pa-1",
      mask: "0000",
      type: "depository",
      subtype: "checking",
    });
    expect(json.existingCandidates).toHaveLength(1);
    expect(json.existingCandidates[0].id).toBe("manual-1");
    // access_token must be encrypted before insert
    const inserted = dbInsert.mock.results[0].value.values.mock.calls[0][0];
    expect(inserted.accessToken).toBe("enc:access-sandbox-x");
    expect(inserted.plaidItemId).toBe("plaid-item-x");
    expect(inserted.institutionName).toBe("Chase");
  });

  it("rejects when publicToken missing", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("https://x/", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
  });
});
