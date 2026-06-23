import { describe, expect, it, vi, beforeEach } from "vitest";

const resolvePortalClient = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: (...a: unknown[]) => resolvePortalClient(...a),
}));
vi.mock("@/lib/authz", () => ({ authErrorResponse: () => null }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkPortalPlaidRefreshRateLimit: () => Promise.resolve({ allowed: true, remaining: 9, reset: 0 }),
  rateLimitErrorResponse: () => new Response("rl", { status: 429 }),
}));
const accountsGet = vi.fn();
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: () => ({ accountsGet }) }));
vi.mock("@/lib/plaid/crypto", () => ({ decrypt: (s: string) => s }));

const loadLinkCandidates = vi.fn();
vi.mock("@/lib/plaid/portal-link-helpers", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, loadLinkCandidates: (...a: unknown[]) => loadLinkCandidates(...a) };
});

const dbSelect = vi.fn();
vi.mock("@/db", () => ({ db: { select: (...a: unknown[]) => dbSelect(...a) } }));

// dbSelect chain supporting both `.limit()` (item lookup) and bare `.where()`
// (linked accounts/liabilities arrays).
let queue: unknown[][] = [];
function nextResponses(...responses: unknown[][]) {
  queue = responses.slice();
}
function shift(): unknown[] {
  return queue.shift() ?? [];
}

beforeEach(() => {
  resolvePortalClient.mockReset().mockResolvedValue({ clientId: "client-1", mode: "client", clerkUserId: "u1" });
  loadLinkCandidates.mockReset().mockResolvedValue({ existingCandidates: [], existingLiabilityCandidates: [] });
  accountsGet.mockReset();
  dbSelect.mockReset().mockImplementation(() => {
    const result = shift();
    const thenable = {
      where: () => thenable,
      limit: () => Promise.resolve(result),
      then: (r: (v: unknown[]) => void) => r(result),
    };
    return { from: () => thenable };
  });
});

describe("GET /api/portal/plaid/items/[id]/accounts", () => {
  it("returns linked + available (available excludes already-linked)", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Tartan Bank", accessToken: "tok" }], // item
      [{ id: "acct-1", name: "Checking", value: "5000", plaidAccountId: "pa-1", mask: "1234" }], // linked accounts
      [], // linked liabilities
    );
    accountsGet.mockResolvedValue({
      data: {
        accounts: [
          { account_id: "pa-1", name: "Checking", official_name: null, mask: "1234", type: "depository", subtype: "checking", balances: { current: 5000 } },
          { account_id: "pa-2", name: "Brokerage", official_name: null, mask: "9012", type: "investment", subtype: "brokerage", balances: { current: 12000 } },
        ],
      },
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x/"), { params: Promise.resolve({ id: "item-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.linked).toHaveLength(1);
    expect(json.available).toHaveLength(1);
    expect(json.available[0].plaidAccountId).toBe("pa-2");
    expect(json.needsReauth).toBe(false);
  });

  it("404s for a foreign item", async () => {
    nextResponses([{ clientId: "OTHER", institutionName: "X", accessToken: "tok" }]);
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x/"), { params: Promise.resolve({ id: "item-1" }) });
    expect(res.status).toBe(404);
  });

  it("excludes a linked liability's plaidAccountId from available", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Tartan Bank", accessToken: "tok" }], // item
      [], // linked accounts (none)
      [{ id: "liab-1", name: "Auto Loan", value: "8000", plaidAccountId: "pa-1" }], // linked liabilities
    );
    accountsGet.mockResolvedValue({
      data: {
        accounts: [
          { account_id: "pa-1", name: "Auto Loan", official_name: null, mask: "5555", type: "loan", subtype: "auto", balances: { current: 8000 } },
          { account_id: "pa-2", name: "Savings", official_name: null, mask: "9999", type: "depository", subtype: "savings", balances: { current: 3000 } },
        ],
      },
    });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x/"), { params: Promise.resolve({ id: "item-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    // pa-1 is linked as a liability — must NOT appear in available
    expect(json.available.map((a: { plaidAccountId: string }) => a.plaidAccountId)).not.toContain("pa-1");
    // pa-2 is unlinked — must still appear in available
    expect(json.available.map((a: { plaidAccountId: string }) => a.plaidAccountId)).toContain("pa-2");
  });

  it("returns needsReauth when accountsGet throws ITEM_LOGIN_REQUIRED", async () => {
    nextResponses(
      [{ clientId: "client-1", institutionName: "Tartan Bank", accessToken: "tok" }],
      [], [],
    );
    accountsGet.mockRejectedValue({ response: { data: { error_code: "ITEM_LOGIN_REQUIRED" } } });
    const { GET } = await import("../route");
    const res = await GET(new Request("https://x/"), { params: Promise.resolve({ id: "item-1" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.needsReauth).toBe(true);
    expect(json.available).toEqual([]);
  });
});
