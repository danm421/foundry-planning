import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const loadMock = vi.fn();
vi.mock("@/lib/portal/load-profile-data", () => ({
  loadPortalFamily: (id: string) => loadMock(id),
}));

import { GET } from "@/app/api/portal/family/route";

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  loadMock.mockReset();
  loadMock.mockResolvedValue([
    { id: "fm1", firstName: "Kid", lastName: "Doe", relationship: "child", dateOfBirth: "2015-01-01" },
  ]);
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
});

describe("GET /api/portal/family", () => {
  it("returns family members wrapped as { members }", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members).toHaveLength(1);
    expect(body.members[0].id).toBe("fm1");
    expect(loadMock).toHaveBeenCalledWith("c1");
  });

  it("propagates auth errors through authErrorResponse", async () => {
    resolveMock.mockRejectedValue(new Error("nope"));
    authErrMock.mockReturnValue({ status: 403, body: { error: "forbidden" } });

    const res = await GET();

    expect(res.status).toBe(403);
  });
});
