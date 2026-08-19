// The Accounts drawer's Holdings tab reads this route. Its two gates — the
// advisor's Investments switch and the portal's account-visibility rule — are
// the point of the file, so both are proven to fire *before* any position is
// read, not merely to change the status code afterwards.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { ForbiddenError } = vi.hoisted(() => {
  class ForbiddenError extends Error {
    constructor(m?: string) {
      super(m);
      this.name = "ForbiddenError";
    }
  }
  return { ForbiddenError };
});

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));

const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(
  () => null,
);
vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) => authErrMock(e),
  ForbiddenError,
}));

const requireFeatureMock = vi.fn();
vi.mock("@/lib/portal/load-features", () => ({
  requirePortalFeature: (clientId: string, feature: string) =>
    requireFeatureMock(clientId, feature),
}));

const visibleMock = vi.fn();
vi.mock("@/lib/portal/assert-portal-visible-target", () => ({
  assertPortalVisibleTarget: (clientId: string, id: string | undefined) =>
    visibleMock(clientId, id),
}));

const loadHoldingsMock = vi.fn();
vi.mock("@/lib/investments/load-enriched-holdings", () => ({
  loadEnrichedHoldings: (ids: string[]) => loadHoldingsMock(ids),
}));

import { GET } from "@/app/api/portal/accounts/[id]/holdings/route";

const ctx = (id = "a1"): { params: Promise<{ id: string }> } => ({
  params: Promise.resolve({ id }),
});
const req = (): Request => new Request("http://localhost/api/portal/accounts/a1/holdings");

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  requireFeatureMock.mockReset();
  requireFeatureMock.mockResolvedValue(undefined);
  visibleMock.mockReset();
  visibleMock.mockResolvedValue({ ok: true });
  loadHoldingsMock.mockReset();
  loadHoldingsMock.mockResolvedValue(new Map());
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
});

describe("GET /api/portal/accounts/[id]/holdings", () => {
  it("returns the account's positions, largest-first", async () => {
    loadHoldingsMock.mockResolvedValue(
      new Map([
        [
          "a1",
          [
            // Tickered: value derives from shares × price.
            { displayTicker: "VTI", displayName: "Vanguard Total Stock", shares: "10", price: "240.00", marketValue: null, costBasis: "1800.00" },
            // Untickered: the stored market value is authoritative — a bond
            // quotes per $100 par, so shares × price is not its worth.
            { displayTicker: null, displayName: "Treasury 4.25% 2030", shares: "25000", price: "99.5000", marketValue: "24875.00", costBasis: null },
          ],
        ],
      ]),
    );
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.holdings).toEqual([
      { ticker: null, name: "Treasury 4.25% 2030", shares: 25000, price: 99.5, marketValue: 24875, costBasis: null },
      { ticker: "VTI", name: "Vanguard Total Stock", shares: 10, price: 240, marketValue: 2400, costBasis: 1800 },
    ]);
    expect(loadHoldingsMock).toHaveBeenCalledWith(["a1"]);
  });

  it("answers an empty list for an account that holds nothing", async () => {
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).holdings).toEqual([]);
  });

  it("403s on the Investments switch without reading a single position", async () => {
    requireFeatureMock.mockRejectedValue(new ForbiddenError("off"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "off" } });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(403);
    expect(requireFeatureMock).toHaveBeenCalledWith("c1", "investments");
    expect(loadHoldingsMock).not.toHaveBeenCalled();
  });

  it("passes the visibility verdict through, and reads nothing when it fails", async () => {
    visibleMock.mockResolvedValue({ ok: false, status: 403, error: "That account is managed by your advisor" });
    const res = await GET(req(), ctx("hidden"));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "That account is managed by your advisor" });
    expect(visibleMock).toHaveBeenCalledWith("c1", "hidden");
    expect(loadHoldingsMock).not.toHaveBeenCalled();
  });

  it("400s for an account that is not this client's", async () => {
    visibleMock.mockResolvedValue({ ok: false, status: 400, error: "Account not found for this client" });
    const res = await GET(req(), ctx("someone-elses"));
    expect(res.status).toBe(400);
    expect(loadHoldingsMock).not.toHaveBeenCalled();
  });

  it("propagates auth errors through authErrorResponse", async () => {
    resolveMock.mockRejectedValue(new Error("nope"));
    authErrMock.mockReturnValue({ status: 401, body: { error: "unauthorized" } });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(401);
  });
});
