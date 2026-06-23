import { describe, it, expect, vi, beforeEach } from "vitest";

const resolvePortalClientMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolvePortalClientMock(),
}));

vi.mock("@/lib/authz", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  authErrorResponse: (e: unknown) =>
    e instanceof Error && e.message.includes("Forbidden")
      ? { status: 403, body: { error: e.message } }
      : null,
}));

const requireEditEnabledMock = vi.fn();
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: () => Promise.resolve(),
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (id: string) => requireEditEnabledMock(id),
}));

const insertChain = vi.fn();
const selectChain = vi.fn();
vi.mock("@/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => ({ returning: () => insertChain(v) }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({ limit: () => selectChain() }),
      }),
    }),
  },
}));

const recordCreateMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (...a: unknown[]) => recordCreateMock(...a),
}));

import { POST } from "@/app/api/portal/family/route";

beforeEach(() => {
  resolvePortalClientMock.mockReset();
  requireEditEnabledMock.mockReset();
  insertChain.mockReset();
  selectChain.mockReset();
  recordCreateMock.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/portal/family", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/portal/family", () => {
  it("rejects missing firstName", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    const res = await POST(req({ relationship: "child" }));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid relationship value with 400", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    const res = await POST(req({ firstName: "Kid", relationship: "bogus" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid relationship");
  });

  it("inserts a row scoped to the bound client and logs as actor 'client'", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    selectChain.mockResolvedValue([{ firmId: "firm-1" }]);
    insertChain.mockResolvedValue([{ id: "fm-new" }]);
    const res = await POST(req({ firstName: "Kid", relationship: "child" }));
    expect(res.status).toBe(200);
    expect(insertChain).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c1", firstName: "Kid" }),
    );
    expect(recordCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorKind: "client" }),
    );
  });
});
