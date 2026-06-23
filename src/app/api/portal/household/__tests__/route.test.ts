import { describe, it, expect, vi, beforeEach } from "vitest";

const resolvePortalClientMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolvePortalClientMock(),
}));

vi.mock("@/lib/authz", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  authErrorResponse: (e: unknown) =>
    e && (e as { name?: string }).name === "ForbiddenError"
      ? { status: 403, body: { error: (e as Error).message } }
      : undefined,
}));

const requireEditEnabledMock = vi.fn();
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (id: string) => requireEditEnabledMock(id),
}));

const updateChain = vi.fn();
const selectChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    update: () => ({
      set: (vals: unknown) => ({ where: () => updateChain(vals) }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => selectChain() }),
      }),
    }),
  },
}));

const recordUpdateMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (...a: unknown[]) => recordUpdateMock(...a),
}));

import { PUT } from "@/app/api/portal/household/route";

beforeEach(() => {
  resolvePortalClientMock.mockReset();
  requireEditEnabledMock.mockReset();
  updateChain.mockReset();
  selectChain.mockReset();
  recordUpdateMock.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/portal/household", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("PUT /api/portal/household", () => {
  it("403s when editing is disabled", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockRejectedValue(
      Object.assign(new Error("disabled"), { name: "ForbiddenError" }),
    );
    const res = await PUT(req({ primary: { firstName: "Jane" } }));
    expect(res.status).toBe(403);
  });

  it("updates primary contact fields", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain
      .mockResolvedValueOnce([{ firmId: "firm-1", crmHouseholdId: "h1" }])
      .mockResolvedValueOnce([{ id: "contact-1", firstName: "Old" }]);
    const res = await PUT(req({ primary: { firstName: "Jane", lastName: "Doe" } }));
    expect(res.status).toBe(200);
    expect(updateChain).toHaveBeenCalledWith(
      expect.objectContaining({ firstName: "Jane", lastName: "Doe" }),
    );
    expect(recordUpdateMock).toHaveBeenCalled();
  });
});
