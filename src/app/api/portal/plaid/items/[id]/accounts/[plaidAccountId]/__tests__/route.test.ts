import { describe, expect, it, vi, beforeEach } from "vitest";

const resolvePortalClient = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: (...a: unknown[]) => resolvePortalClient(...a),
}));
vi.mock("@/lib/authz", () => ({ authErrorResponse: () => null }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));
const requireEditEnabled = vi.fn();
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (...a: unknown[]) => requireEditEnabled(...a),
}));
const recordUpdate = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (...a: unknown[]) => recordUpdate(...a),
}));

const dbSelect = vi.fn();
const accountsUpdateWhere = vi.fn().mockResolvedValue(undefined);
const liabilitiesUpdateWhere = vi.fn().mockResolvedValue(undefined);
let updateTarget: "accounts" | "liabilities" = "accounts";
const dbUpdate = vi.fn().mockImplementation(() => ({
  set: () => ({
    where: (...a: unknown[]) =>
      updateTarget === "accounts" ? accountsUpdateWhere(...a) : liabilitiesUpdateWhere(...a),
  }),
}));
vi.mock("@/db", () => ({
  db: {
    select: (...a: unknown[]) => dbSelect(...a),
    update: (...a: unknown[]) => dbUpdate(...a),
  },
}));

let queue: unknown[][] = [];
function nextResponses(...responses: unknown[][]) {
  queue = responses.slice();
}
beforeEach(() => {
  resolvePortalClient.mockReset().mockResolvedValue({ clientId: "client-1", mode: "client", clerkUserId: "u1" });
  requireEditEnabled.mockReset().mockResolvedValue(undefined);
  recordUpdate.mockReset().mockResolvedValue(undefined);
  accountsUpdateWhere.mockClear();
  liabilitiesUpdateWhere.mockClear();
  dbSelect.mockReset().mockImplementation(() => ({
    from: () => ({ where: () => ({ limit: () => Promise.resolve(queue.shift() ?? []) }) }),
  }));
});

async function callDelete(params: { id: string; plaidAccountId: string }) {
  const { DELETE } = await import("../route");
  return DELETE(new Request("https://x/", { method: "DELETE" }), {
    params: Promise.resolve(params),
  });
}

describe("DELETE /items/[id]/accounts/[plaidAccountId]", () => {
  it("detaches a matching account (nulls plaid ids, audits)", async () => {
    updateTarget = "accounts";
    nextResponses(
      [{ clientId: "client-1", institutionName: "Tartan Bank" }], // item
      [{ firmId: "firm-1" }], // client
      [{ id: "acct-1", name: "Checking" }], // account match
    );
    const res = await callDelete({ id: "item-1", plaidAccountId: "pa-1" });
    expect(res.status).toBe(200);
    expect(accountsUpdateWhere).toHaveBeenCalledTimes(1);
    expect(recordUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ action: "portal.plaid.account_detach" }),
    );
  });

  it("falls back to liabilities when no account matches", async () => {
    updateTarget = "liabilities";
    nextResponses(
      [{ clientId: "client-1", institutionName: "Tartan Bank" }], // item
      [{ firmId: "firm-1" }], // client
      [], // no account match
      [{ id: "liab-1", name: "Card" }], // liability match
    );
    const res = await callDelete({ id: "item-1", plaidAccountId: "pa-2" });
    expect(res.status).toBe(200);
    expect(liabilitiesUpdateWhere).toHaveBeenCalledTimes(1);
  });

  it("404s for a foreign item", async () => {
    nextResponses([{ clientId: "OTHER", institutionName: "X" }]);
    const res = await callDelete({ id: "item-1", plaidAccountId: "pa-1" });
    expect(res.status).toBe(404);
  });

  it("404s when no account or liability matches", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Tartan Bank" }],
      [{ firmId: "firm-1" }],
      [], // no account
      [], // no liability
    );
    const res = await callDelete({ id: "item-1", plaidAccountId: "pa-x" });
    expect(res.status).toBe(404);
  });
});
