import { describe, it, expect, vi, beforeEach } from "vitest";
// Section switches all on — they have their own tests (require-portal-feature,
// feature-gate-403, feature-gate-coverage).
vi.mock("@/lib/portal/load-features", () => import("@/lib/portal/__tests__/load-features-mock"));

const { ForbiddenError } = vi.hoisted(() => ({ ForbiddenError: class extends Error {} }));
const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) =>
    e instanceof ForbiddenError ? { status: 403, body: { error: "Forbidden" } } : null,
}));
// The client shares Budget but keeps Transactions private.
vi.mock("@/lib/portal/privacy", () => ({
  requireAreaShared: async (mode: string, _id: string, area: string) => {
    if (mode === "advisor" && area === "transactions") throw new ForbiddenError("not shared");
  },
}));
const countMock = vi.fn();
vi.mock("@/lib/portal/recategorize", () => ({
  countRuleMatches: (...a: unknown[]) => countMock(...a),
}));

import { GET } from "@/app/api/portal/rules/preview/route";

const call = () => GET(new Request("http://t/api/portal/rules/preview?matchType=contains&pattern=a"));

beforeEach(() => {
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  countMock.mockReset();
  countMock.mockResolvedValue(3);
});

describe("GET /api/portal/rules/preview", () => {
  it("refuses an advisor when the client keeps transactions private", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "u1" });
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty("count");
    expect(countMock).not.toHaveBeenCalled();
  });

  it("gives the client the match count", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ count: 3 });
  });
});
