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
  scenarios: { _name: "scenarios" },
  clients: { _name: "clients" },
  liabilities: { _name: "liabilities" },
  liabilityOwners: { _name: "liabilityOwners" },
  liabilityTypeEnum: {
    enumValues: ["mortgage", "heloc", "auto", "student", "personal", "credit_card", "other"] as const,
  },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));

let scenarioRows: Record<string, unknown>[] = [{ id: "scenario-base-1" }];
const clientRows = [{ firmId: "firm-1" }];

const insertLiabilityValuesMock = vi.fn().mockResolvedValue([{ id: "liab-new" }]);
const insertOwnerValuesMock = vi.fn().mockResolvedValue(undefined);
const transactionMock = vi.fn(async (fn: (tx: unknown) => unknown) => {
  const tx = {
    insert: (tbl: { _name: string }) => ({
      values: (v: unknown) =>
        tbl._name === "liabilities"
          ? { returning: () => insertLiabilityValuesMock(v) }
          : insertOwnerValuesMock(v),
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
            if (tbl._name === "scenarios") return Promise.resolve(scenarioRows);
            if (tbl._name === "clients") return Promise.resolve(clientRows);
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

const recordCreateMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (args: unknown) => recordCreateMock(args),
}));

import { POST } from "@/app/api/portal/liabilities/route";

const OWNER = { kind: "family_member", familyMemberId: "fm1", percent: 1 };

beforeEach(() => {
  scenarioRows = [{ id: "scenario-base-1" }];
  resolvePortalClientMock.mockReset().mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  authErrorResponseMock.mockReset().mockReturnValue(null);
  requireEditEnabledMock.mockReset().mockResolvedValue(undefined);
  requirePortalActiveSubscriptionMock.mockReset().mockResolvedValue(undefined);
  insertLiabilityValuesMock.mockClear();
  insertOwnerValuesMock.mockClear();
  transactionMock.mockClear();
  validateOwnersShapeMock.mockReset().mockReturnValue({ owners: [OWNER] });
  validateOwnersTenantMock.mockReset().mockResolvedValue(null);
  validateTrustOnlyEntityOwnersMock.mockReset().mockResolvedValue(null);
  recordCreateMock.mockReset();
});

function req(body: unknown): Request {
  return new Request("http://localhost/api/portal/liabilities", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/portal/liabilities", () => {
  it("returns 403 and performs no insert when edit is disabled", async () => {
    requireEditEnabledMock.mockRejectedValue(new ForbiddenError("edit disabled"));
    authErrorResponseMock.mockReturnValue({ body: { error: "Forbidden" }, status: 403 });
    const res = await POST(req({ name: "Car Loan", liabilityType: "auto", owners: [OWNER] }));
    expect(res.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 403 and performs no insert when the firm subscription is inactive", async () => {
    requirePortalActiveSubscriptionMock.mockRejectedValue(new ForbiddenError("Active subscription required"));
    authErrorResponseMock.mockReturnValue({ body: { error: "Active subscription required" }, status: 403 });
    const res = await POST(req({ name: "Car Loan", liabilityType: "auto", owners: [OWNER] }));
    expect(res.status).toBe(403);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing", async () => {
    const res = await POST(req({ liabilityType: "auto", owners: [OWNER] }));
    expect(res.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when liabilityType is not a valid enum value", async () => {
    const res = await POST(req({ name: "Car Loan", liabilityType: "payday", owners: [OWNER] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/liabilityType/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 400 when owners[] is missing or empty", async () => {
    validateOwnersShapeMock.mockReturnValue({ error: "owners must have at least one entry" });
    const res = await POST(req({ name: "Car Loan", liabilityType: "auto", owners: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/owners/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 400 and performs no insert when an owner belongs to another client", async () => {
    validateOwnersTenantMock.mockResolvedValue({ error: "owner not in this household" });
    const res = await POST(req({ name: "Car Loan", liabilityType: "auto", owners: [OWNER] }));
    expect(res.status).toBe(400);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 400 and performs no insert when an entity owner is not a trust", async () => {
    validateTrustOnlyEntityOwnersMock.mockResolvedValue({ error: "entity owners must be trusts" });
    const res = await POST(req({ name: "LLC Note", liabilityType: "personal", owners: [{ kind: "entity", entityId: "llc1", percent: 1 }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/trust/i);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the client has no base scenario", async () => {
    scenarioRows = [];
    const res = await POST(req({ name: "Car Loan", liabilityType: "auto", owners: [OWNER] }));
    expect(res.status).toBe(404);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("inserts the liability held flat, writes owner rows, and audits", async () => {
    const res = await POST(
      req({ name: "Car Loan", liabilityType: "auto", balance: "18500", owners: [OWNER] }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "liab-new" });

    const values = insertLiabilityValuesMock.mock.calls[0][0];
    expect(values).toMatchObject({
      clientId: "c1",
      scenarioId: "scenario-base-1",
      name: "Car Loan",
      liabilityType: "auto",
      balance: "18500",
    });
    // No term and no payment: isHeldFlatLiability() keeps the balance on the
    // projection instead of amortizing an empty schedule down to zero.
    expect(values.termMonths).toBeNull();
    expect(values.monthlyPayment).toBeNull();
    expect(values.interestRate).toBe("0");
    expect(values.isInterestDeductible).toBe(false);

    expect(insertOwnerValuesMock).toHaveBeenCalledWith({
      liabilityId: "liab-new",
      familyMemberId: "fm1",
      entityId: null,
      percent: "1",
    });

    expect(recordCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.liability.create",
        resourceType: "liability",
        resourceId: "liab-new",
        clientId: "c1",
        firmId: "firm-1",
        actorKind: "client",
        snapshot: { name: "Car Loan", liabilityType: "auto", balance: "18500" },
      }),
    );
  });

  it("defaults a missing balance to 0", async () => {
    await POST(req({ name: "Car Loan", liabilityType: "auto", owners: [OWNER] }));
    expect(insertLiabilityValuesMock.mock.calls[0][0].balance).toBe("0");
  });

  it("tags an advisor preview write as viaPreview", async () => {
    resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "u1" });
    await POST(req({ name: "Car Loan", liabilityType: "auto", owners: [OWNER] }));
    expect(recordCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ actorKind: "advisor", extraMetadata: { viaPreview: true } }),
    );
  });
});
