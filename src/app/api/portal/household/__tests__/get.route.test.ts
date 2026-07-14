import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const loadMock = vi.fn();
vi.mock("@/lib/portal/load-profile-data", () => ({
  loadPortalHousehold: (id: string) => loadMock(id),
}));

import { GET } from "@/app/api/portal/household/route";

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  loadMock.mockReset();
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
});

describe("GET /api/portal/household", () => {
  it("returns the household DTO for the bound client", async () => {
    loadMock.mockResolvedValue({
      filingStatus: "married_filing_jointly",
      lifeExpectancy: 90,
      primary: { id: "c1", firstName: "Jane", lastName: "Doe", email: null, phone: null },
      spouse: null,
    });

    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.filingStatus).toBe("married_filing_jointly");
    expect(body.primary.firstName).toBe("Jane");
    expect(loadMock).toHaveBeenCalledWith("c1");
  });

  it("404s when the loader returns null (client row missing)", async () => {
    loadMock.mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(404);
  });

  it("propagates auth errors through authErrorResponse", async () => {
    resolveMock.mockRejectedValue(new Error("nope"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "forbidden" } });

    const res = await GET();

    expect(res.status).toBe(403);
  });
});
