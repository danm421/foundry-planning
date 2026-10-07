import { describe, it, expect, vi, beforeEach } from "vitest";
// Section switches all on — they have their own tests (require-portal-feature,
// feature-gate-403, feature-gate-coverage).
vi.mock("@/lib/portal/load-features", () => import("@/lib/portal/__tests__/load-features-mock"));

const { ALL_ON } = vi.hoisted(() => ({
  ALL_ON: { shareTransactions: true, shareBudgets: true, shareRecurrings: true },
}));
const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
vi.mock("@/lib/authz", () => ({ authErrorResponse: () => null }));
// The client shares Recurring bills but keeps Transactions private; a real
// client always gets every switch on.
vi.mock("@/lib/portal/privacy", () => ({
  requireAreaShared: async (mode: string) =>
    mode === "advisor" ? { ...ALL_ON, shareTransactions: false } : ALL_ON,
}));
const loadMock = vi.fn();
vi.mock("@/lib/portal/load-recurrings-data", () => ({
  loadRecurringsData: (...a: unknown[]) => loadMock(...a),
}));
// POST-only dependencies; GET never reaches them.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/portal/require-edit-enabled", () => ({ requireEditEnabled: vi.fn() }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: vi.fn(),
}));
vi.mock("@/lib/audit/record-helpers", () => ({ recordCreate: vi.fn() }));
vi.mock("@/lib/portal/claim-recurring", () => ({ claimRecurringRetroactively: vi.fn() }));

import { GET } from "@/app/api/portal/recurrings/route";

beforeEach(() => {
  loadMock.mockReset();
  loadMock.mockResolvedValue({ recurrings: [], paidSoFar: 0, leftToPay: 0, month: "2026-09", suggestions: [] });
});

describe("GET /api/portal/recurrings", () => {
  it("leaves suggestions out for an advisor when the client keeps transactions private", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "u1" });
    expect((await GET()).status).toBe(200);
    expect(loadMock).toHaveBeenCalledWith("c1", expect.any(Date), { includeSuggestions: false });
  });

  it("always includes suggestions for the client", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    expect((await GET()).status).toBe(200);
    expect(loadMock).toHaveBeenCalledWith("c1", expect.any(Date), { includeSuggestions: true });
  });
});
