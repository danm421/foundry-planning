import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const loadMock = vi.fn();
vi.mock("@/lib/portal/load-profile-data", () => ({
  loadPortalTrusts: (id: string) => loadMock(id),
}));

import { GET } from "@/app/api/portal/trusts/route";

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  loadMock.mockReset();
  loadMock.mockResolvedValue([
    { id: "t1", name: "Family Trust", entityType: "trust", value: 125000.5, isGrantor: true },
  ]);
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
});

describe("GET /api/portal/trusts", () => {
  it("returns trusts wrapped as { trusts }", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trusts).toHaveLength(1);
    expect(body.trusts[0].value).toBe(125000.5);
    expect(loadMock).toHaveBeenCalledWith("c1");
  });

  it("propagates auth errors through authErrorResponse", async () => {
    resolveMock.mockRejectedValue(new Error("nope"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "forbidden" } });

    const res = await GET();

    expect(res.status).toBe(403);
  });
});
