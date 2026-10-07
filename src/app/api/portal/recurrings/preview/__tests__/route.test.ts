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
// The client shares Recurring bills but keeps Transactions private.
vi.mock("@/lib/portal/privacy", () => ({
  requireAreaShared: async (mode: string, _id: string, area: string) => {
    if (mode === "advisor" && area === "transactions") throw new ForbiddenError("not shared");
  },
}));
const previewMock = vi.fn();
vi.mock("@/lib/portal/claim-recurring", () => ({
  previewRecurringMatches: (...a: unknown[]) => previewMock(...a),
}));

import { GET } from "@/app/api/portal/recurrings/preview/route";

const PREVIEW = {
  count: 1,
  sample: [{ id: "t1", merchantName: "Pharmacy", name: "Pharmacy", amount: "12.50", date: "2026-09-01" }],
};
const call = () =>
  GET(
    new Request(
      "http://t/api/portal/recurrings/preview?matchType=contains&pattern=a&amountMin=-100&amountMax=100",
    ),
  );

beforeEach(() => {
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  previewMock.mockReset();
  previewMock.mockResolvedValue(PREVIEW);
});

describe("GET /api/portal/recurrings/preview", () => {
  it("refuses an advisor when the client keeps transactions private", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "u1" });
    const res = await call();
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).not.toHaveProperty("count");
    expect(body).not.toHaveProperty("sample");
    expect(previewMock).not.toHaveBeenCalled();
  });

  it("gives the client the match count and sample", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(PREVIEW);
  });
});
