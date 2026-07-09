import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const loadMock = vi.fn();
vi.mock("@/lib/portal/load-accounts-overview", () => ({
  loadAccountsOverview: (id: string) => loadMock(id),
}));

import { GET } from "@/app/api/portal/accounts/overview/route";

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  loadMock.mockReset();
  loadMock.mockResolvedValue({
    assets: [{ id: "a1", name: "Checking", category: "cash", subType: "checking", last4: "1234", value: 5000, isPlaidLinked: true }],
    debts: [],
    netWorth: { assets: 5000, debt: 0, netWorth: 5000 },
  });
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
});

describe("GET /api/portal/accounts/overview", () => {
  it("returns the accounts overview for the bound client", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.netWorth.netWorth).toBe(5000);
    expect(body.assets[0].id).toBe("a1");
    expect(loadMock).toHaveBeenCalledWith("c1");
  });

  it("propagates auth errors through authErrorResponse", async () => {
    resolveMock.mockRejectedValue(new Error("nope"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "forbidden" } });
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
