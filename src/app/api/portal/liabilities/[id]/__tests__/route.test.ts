import { describe, it, expect, vi, beforeEach } from "vitest";

const { ForbiddenError } = vi.hoisted(() => {
  class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return { ForbiddenError };
});

const resolvePortalClientMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolvePortalClientMock(),
}));

const authErrorResponseMock = vi.fn();
vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) => authErrorResponseMock(e),
  ForbiddenError,
  UnauthorizedError: class extends Error {},
}));

const requireEditEnabledMock = vi.fn();
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (id: string) => requireEditEnabledMock(id),
}));

const requirePortalActiveSubscriptionMock = vi.fn();
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: (id: string) => requirePortalActiveSubscriptionMock(id),
}));

vi.mock("@/db/schema", () => ({
  liabilities: { _name: "liabilities" },
  liabilityOwners: { _name: "liabilityOwners" },
  clients: { _name: "clients" },
  liabilityTypeEnum: {
    enumValues: ["mortgage", "heloc", "auto", "student", "personal", "credit_card", "other"] as const,
  },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));

let liabilityRow: Record<string, unknown> | null = { id: "liab-1", clientId: "c1", name: "Old Loan", balance: "1000.00", liabilityType: "personal", plaidItemId: null };
let clientRow: Record<string, unknown> | null = { firmId: "firm-1" };

const updateMock = vi.fn();
const deleteLiabilitiesMock = vi.fn();
const deleteOwnersMock = vi.fn();
const insertOwnerMock = vi.fn();
const transactionMock = vi.fn(async (fn: (tx: unknown) => unknown) => {
  const tx = {
    update: (tbl: { _name: string }) => ({
      set: (vals: unknown) => ({ where: () => updateMock(tbl._name, vals) }),
    }),
    delete: (tbl: { _name: string }) => ({
      where: () => {
        if (tbl._name === "liabilityOwners") return deleteOwnersMock();
        if (tbl._name === "liabilities") return deleteLiabilitiesMock();
        return Promise.resolve();
      },
    }),
    insert: (tbl: { _name: string }) => ({
      values: (vals: unknown) => insertOwnerMock(tbl._name, vals),
    }),
  };
  return fn(tx);
});

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: string }) => ({
        where: () => ({
          limit: () => {
            if (tbl._name === "liabilities") return Promise.resolve(liabilityRow ? [liabilityRow] : []);
            if (tbl._name === "clients") return Promise.resolve(clientRow ? [clientRow] : []);
            return Promise.resolve([]);
          },
        }),
      }),
    }),
    transaction: (fn: (tx: unknown) => unknown) => transactionMock(fn),
  },
}));

const validateOwnersShapeMock = vi.fn();
const validateOwnersTenantMock = vi.fn();
vi.mock("@/lib/ownership", () => ({
  validateOwnersShape: (raw: unknown) => validateOwnersShapeMock(raw),
  validateOwnersTenant: (owners: unknown, cid: string) => validateOwnersTenantMock(owners, cid),
}));

const validateTrustOnlyEntityOwnersMock = vi.fn();
vi.mock("@/lib/portal/validate-trust-owners", () => ({
  validateTrustOnlyEntityOwners: (owners: unknown, cid: string) =>
    validateTrustOnlyEntityOwnersMock(owners, cid),
}));

const recordUpdateMock = vi.fn();
const recordDeleteMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (args: unknown) => recordUpdateMock(args),
  recordDelete: (args: unknown) => recordDeleteMock(args),
}));

import { PUT, DELETE } from "@/app/api/portal/liabilities/[id]/route";

beforeEach(() => {
  resolvePortalClientMock.mockReset();
  authErrorResponseMock.mockReset().mockReturnValue(null);
  requireEditEnabledMock.mockReset().mockResolvedValue(undefined);
  updateMock.mockReset();
  deleteLiabilitiesMock.mockReset();
  deleteOwnersMock.mockReset();
  insertOwnerMock.mockReset();
  transactionMock.mockClear();
  validateOwnersShapeMock.mockReset();
  validateOwnersTenantMock.mockReset();
  validateTrustOnlyEntityOwnersMock.mockReset().mockResolvedValue(null);
  requirePortalActiveSubscriptionMock.mockReset().mockResolvedValue(undefined);
  recordUpdateMock.mockReset();
  recordDeleteMock.mockReset();
  liabilityRow = { id: "liab-1", clientId: "c1", name: "Old Loan", balance: "1000.00", liabilityType: "personal", plaidItemId: null };
  clientRow = { firmId: "firm-1" };
});

function putReq(body: unknown) {
  return new Request("http://localhost/api/portal/liabilities/liab-1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
function delReq() {
  return new Request("http://localhost/api/portal/liabilities/liab-1", { method: "DELETE" });
}
const ctx = { params: Promise.resolve({ id: "liab-1" }) };

describe("PUT /api/portal/liabilities/[id]", () => {
  it("404s when the liability belongs to a different client", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c2", mode: "client", clerkUserId: "u1" });
    const res = await PUT(putReq({ name: "X" }), ctx);
    expect(res.status).toBe(404);
  });

  it("updates editable fields, replaces owners, and records audit", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    validateOwnersShapeMock.mockReturnValue({
      owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 1 }],
    });
    validateOwnersTenantMock.mockResolvedValue(null);

    const res = await PUT(
      putReq({
        name: "New Loan",
        liabilityType: "student",
        balance: "2500.00",
        owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 1 }],
      }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      "liabilities",
      expect.objectContaining({ name: "New Loan", liabilityType: "student", balance: "2500.00" }),
    );
    expect(deleteOwnersMock).toHaveBeenCalled();
    expect(insertOwnerMock).toHaveBeenCalledWith(
      "liabilityOwners",
      expect.objectContaining({ liabilityId: "liab-1", familyMemberId: "fm1", percent: "1" }),
    );
    expect(recordUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.liability.update",
        resourceType: "liability",
        resourceId: "liab-1",
        clientId: "c1",
        firmId: "firm-1",
        actorKind: "client",
      }),
    );
  });

  it("tags viaPreview in advisor act-as mode", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "u1" });
    const res = await PUT(putReq({ name: "Renamed" }), ctx);
    expect(res.status).toBe(200);
    expect(recordUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorKind: "advisor", extraMetadata: { viaPreview: true } }),
    );
  });

  it("returns 400 when liabilityType is not a valid enum value", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    const res = await PUT(putReq({ liabilityType: "not_a_real_type" }), ctx);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/liabilityType/i);
  });

  it("rejects a balance patch on a Plaid-linked debt with 400", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    liabilityRow = { id: "liab-1", clientId: "c1", name: "Plaid Mortgage", balance: "56302.06", liabilityType: "mortgage", plaidItemId: "item-x" };
    const res = await PUT(putReq({ balance: "1.00" }), ctx);
    expect(res.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("accepts name / type / owners patches on a Plaid-linked debt", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    liabilityRow = { id: "liab-1", clientId: "c1", name: "Plaid Mortgage", balance: "56302.06", liabilityType: "mortgage", plaidItemId: "item-x" };
    const res = await PUT(putReq({ name: "Home loan" }), ctx);
    expect(res.status).toBe(200);
  });

  it("400s and performs no mutation when an entity owner is not a trust", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    validateOwnersShapeMock.mockReturnValue({ owners: [{ kind: "entity", entityId: "llc1", percent: 1 }] });
    validateOwnersTenantMock.mockResolvedValue(null);
    validateTrustOnlyEntityOwnersMock.mockResolvedValue({ error: "entity owners must be trusts" });
    const res = await PUT(putReq({ owners: [{ kind: "entity", entityId: "llc1", percent: 1 }] }), ctx);
    expect(res.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });
});

describe("portal liability mutations — guards", () => {
  function denySub() {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requirePortalActiveSubscriptionMock.mockRejectedValue(new ForbiddenError("Active subscription required"));
    authErrorResponseMock.mockImplementation((e: unknown) =>
      e instanceof ForbiddenError ? { status: 403, body: { error: e.message } } : null,
    );
  }
  function denyEdit() {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    requireEditEnabledMock.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    authErrorResponseMock.mockImplementation((e: unknown) =>
      e instanceof ForbiddenError ? { status: 403, body: { error: e.message } } : null,
    );
  }

  it("PUT 403s and performs no mutation when the firm subscription is inactive", async () => {
    denySub();
    const res = await PUT(putReq({ name: "X" }), ctx);
    expect(res.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("PUT 403s and performs no mutation when editing is disabled", async () => {
    denyEdit();
    const res = await PUT(putReq({ name: "X" }), ctx);
    expect(res.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
    expect(recordUpdateMock).not.toHaveBeenCalled();
  });

  it("DELETE 403s and performs no delete when editing is disabled", async () => {
    denyEdit();
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(403);
    expect(deleteLiabilitiesMock).not.toHaveBeenCalled();
    expect(recordDeleteMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/portal/liabilities/[id]", () => {
  it("404s when the liability belongs to a different client", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c2", mode: "client", clerkUserId: "u1" });
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(404);
    expect(deleteLiabilitiesMock).not.toHaveBeenCalled();
  });

  it("409s when the debt is Plaid-linked", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    liabilityRow = { ...liabilityRow!, plaidItemId: "pli_1" };
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(409);
    expect(deleteLiabilitiesMock).not.toHaveBeenCalled();
  });

  it("deletes the debt and records audit when manual", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(200);
    expect(deleteOwnersMock).toHaveBeenCalled();
    expect(deleteLiabilitiesMock).toHaveBeenCalled();
    expect(recordDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.liability.delete",
        resourceType: "liability",
        resourceId: "liab-1",
        clientId: "c1",
        firmId: "firm-1",
        actorKind: "client",
      }),
    );
  });
});
