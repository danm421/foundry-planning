import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const loadMock = vi.fn();
vi.mock("@/lib/portal/load-portal-investments", () => ({
  loadPortalInvestments: (id: string) => loadMock(id),
}));

import { GET } from "@/app/api/portal/investments/route";

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  loadMock.mockReset();
  loadMock.mockResolvedValue({
    totalValue: 12000,
    totalSeries: [{ date: "2026-01-01", value: 10000 }],
    accounts: [
      {
        id: "a1",
        name: "Brokerage",
        category: "taxable",
        last4: "5678",
        value: 12000,
        series: [{ date: "2026-01-01", value: 10000 }],
        allocations: [{ name: "US Equity", weight: 1 }],
        holdings: [],
      },
    ],
    overallAllocations: [{ name: "US Equity", weight: 1 }],
  });
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
});

describe("GET /api/portal/investments", () => {
  it("returns the investments data for the bound client", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.totalValue).toBe(12000);
    expect(body.accounts[0].id).toBe("a1");
    expect(loadMock).toHaveBeenCalledWith("c1");
  });

  it("propagates auth errors through authErrorResponse", async () => {
    resolveMock.mockRejectedValue(new Error("nope"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "forbidden" } });
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
