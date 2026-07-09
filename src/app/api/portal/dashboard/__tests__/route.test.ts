// src/app/api/portal/dashboard/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn<(e: unknown) => { status: number; body: { error: string } } | null>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const loadDashboardMock = vi.fn();
vi.mock("@/lib/portal/load-dashboard", () => ({
  loadPortalDashboard: (...a: unknown[]) => loadDashboardMock(...a),
}));
const loadPrivacyMock = vi.fn();
const ALL_ON = { shareTransactions: true, shareBudgets: true, shareRecurrings: true };
vi.mock("@/lib/portal/privacy", () => ({
  loadPortalPrivacy: (id: string) => loadPrivacyMock(id),
  DEFAULT_PORTAL_PRIVACY: { shareTransactions: true, shareBudgets: true, shareRecurrings: true },
}));

import { GET } from "@/app/api/portal/dashboard/route";

beforeEach(() => {
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  loadDashboardMock.mockReset();
  loadDashboardMock.mockResolvedValue({ toReview: { count: 3, sample: [] } });
  loadPrivacyMock.mockReset();
  loadPrivacyMock.mockResolvedValue({ ...ALL_ON, shareBudgets: false });
  authErrMock.mockReset();
  authErrMock.mockReturnValue(null);
});

describe("GET /api/portal/dashboard", () => {
  it("client mode: uses DEFAULT_PORTAL_PRIVACY and never queries privacy", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).toReview.count).toBe(3);
    expect(loadPrivacyMock).not.toHaveBeenCalled();
    expect(loadDashboardMock).toHaveBeenCalledWith("c1", expect.any(Date), ALL_ON);
  });

  it("advisor act-as mode: loads the client's sharing switches", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "adv" });
    await GET();
    expect(loadPrivacyMock).toHaveBeenCalledWith("c1");
    expect(loadDashboardMock).toHaveBeenCalledWith("c1", expect.any(Date), { ...ALL_ON, shareBudgets: false });
  });

  it("propagates auth errors through authErrorResponse", async () => {
    resolveMock.mockRejectedValue(new Error("nope"));
    authErrMock.mockReturnValue({ status: 401, body: { error: "unauthorized" } });
    const res = await GET();
    expect(res.status).toBe(401);
  });
});
