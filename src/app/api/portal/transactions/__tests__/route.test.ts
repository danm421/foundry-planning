import { describe, it, expect, vi, beforeEach } from "vitest";
const { ForbiddenError } = vi.hoisted(() => ({ ForbiddenError: class extends Error {} }));
const resolveMock = vi.fn();
const authErrMock = vi.fn();
const loadMock = vi.fn();
const countMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) => authErrMock(e),
  ForbiddenError, UnauthorizedError: class extends Error {},
}));
vi.mock("@/lib/portal/transactions-query", () => ({
  loadPortalTransactions: (...a: unknown[]) => loadMock(...a),
  countPortalTransactions: (...a: unknown[]) => countMock(...a),
}));
const areaSharedMock = vi.fn();
vi.mock("@/lib/portal/privacy", () => ({
  requireAreaShared: (...a: unknown[]) => areaSharedMock(...a),
}));
import { GET } from "@/app/api/portal/transactions/route";

beforeEach(() => {
  resolveMock.mockReset(); authErrMock.mockReset(); loadMock.mockReset(); countMock.mockReset();
  areaSharedMock.mockReset(); areaSharedMock.mockResolvedValue(undefined);
});

const call = (qs = "") => GET(new Request(`http://localhost/api/portal/transactions${qs}`));

describe("GET /api/portal/transactions", () => {
  it("returns transactions + total + hasMore", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    loadMock.mockResolvedValue([{ id: "t1" }]);
    countMock.mockResolvedValue(3);
    const res = await call("?limit=1&offset=0");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.hasMore).toBe(true);
    expect(body.transactions).toHaveLength(1);
  });
  it("clamps limit to MAX and passes filters through", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    loadMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    await call("?limit=9999&categoryId=cat&q=coffee");
    const f = loadMock.mock.calls[0][1];
    expect(f.limit).toBe(100);
    expect(f.categoryId).toBe("cat");
    expect(f.q).toBe("coffee");
  });
  it("advisor act-as preview reads the target client's transactions", async () => {
    resolveMock.mockResolvedValue({ clientId: "previewed-client", mode: "advisor", clerkUserId: "advisor-1" });
    loadMock.mockResolvedValue([{ id: "t1" }]);
    countMock.mockResolvedValue(1);
    const res = await call();
    expect(res.status).toBe(200);
    // The query is scoped to the previewed client, not the advisor.
    expect(loadMock.mock.calls[0][0]).toBe("previewed-client");
    // The privacy gate saw the advisor context for the transactions area.
    expect(areaSharedMock).toHaveBeenCalledWith("advisor", "previewed-client", "transactions");
  });
  it("rejects the advisor when the client has not shared transactions", async () => {
    resolveMock.mockResolvedValue({ clientId: "previewed-client", mode: "advisor", clerkUserId: "advisor-1" });
    areaSharedMock.mockRejectedValue(new ForbiddenError("not shared"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "not shared" } });
    const res = await call();
    expect(res.status).toBe(403);
    expect(loadMock).not.toHaveBeenCalled();
  });
  it("passes the accountId filter through", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    loadMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    await call("?accountId=acct-9");
    expect(loadMock.mock.calls[0][1].accountId).toBe("acct-9");
  });
  it("propagates a portal 403", async () => {
    resolveMock.mockRejectedValue(new ForbiddenError("nope"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "nope" } });
    const res = await call();
    expect(res.status).toBe(403);
  });
  it("passes the reviewed filter through (unreviewed only)", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    loadMock.mockResolvedValue([]);
    countMock.mockResolvedValue(0);
    await call("?reviewed=false");
    expect(loadMock.mock.calls[0][1].reviewed).toBe(false);
  });
});
