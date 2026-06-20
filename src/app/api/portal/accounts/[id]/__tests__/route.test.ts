import { describe, it, expect, vi, beforeEach } from "vitest";

const { ForbiddenError } = vi.hoisted(() => {
  class ForbiddenError extends Error { constructor(m?: string) { super(m); this.name = "ForbiddenError"; } }
  return { ForbiddenError };
});

const requireClientPortalAccessMock = vi.fn();
const authErrorResponseMock = vi.fn();
vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: () => requireClientPortalAccessMock(),
  authErrorResponse: (e: unknown) => authErrorResponseMock(e),
  ForbiddenError,
  UnauthorizedError: class extends Error {},
}));

const requireEditEnabledMock = vi.fn();
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (id: string) => requireEditEnabledMock(id),
}));

vi.mock("@/db/schema", () => ({
  accounts: { _name: "accounts" },
  accountOwners: { _name: "accountOwners" },
  clients: { _name: "clients" },
  // Phase 3 will introduce; placeholder so the import survives.
  plaidItems: { _name: "plaidItems" },
  accountCategoryEnum: {
    enumValues: [
      "taxable",
      "cash",
      "retirement",
      "annuity",
      "real_estate",
      "business",
      "life_insurance",
      "notes_receivable",
      "stock_options",
    ] as const,
  },
  accountSubTypeEnum: {
    enumValues: [
      "brokerage",
      "savings",
      "checking",
      "traditional_ira",
      "roth_ira",
      "401k",
      "403b",
      "529",
      "hsa",
      "trust",
      "other",
      "primary_residence",
      "rental_property",
      "commercial_property",
      "sole_proprietorship",
      "partnership",
      "s_corp",
      "c_corp",
    ] as const,
  },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));

let accountRow: Record<string, unknown> | null = { id: "acct-1", clientId: "c1", name: "Old", category: "cash", subType: "checking", value: "0", accountNumberLast4: null, plaidItemId: null };
let clientRow: Record<string, unknown> | null = { firmId: "firm-1" };

const updateMock = vi.fn();
const deleteAccountsMock = vi.fn();
const deleteOwnersMock = vi.fn();
const insertOwnerMock = vi.fn();
const transactionMock = vi.fn(async (fn: (tx: unknown) => unknown) => {
  const tx = {
    update: (tbl: { _name: string }) => ({
      set: (vals: unknown) => ({
        where: () => updateMock(tbl._name, vals),
      }),
    }),
    delete: (tbl: { _name: string }) => ({
      where: () => {
        if (tbl._name === "accountOwners") return deleteOwnersMock();
        if (tbl._name === "accounts") return deleteAccountsMock();
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
            if (tbl._name === "accounts") return Promise.resolve(accountRow ? [accountRow] : []);
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
const validateAccountOwnershipRulesMock = vi.fn();
vi.mock("@/lib/ownership", () => ({
  validateOwnersShape: (raw: unknown) => validateOwnersShapeMock(raw),
  validateOwnersTenant: (owners: unknown, cid: string) => validateOwnersTenantMock(owners, cid),
  validateAccountOwnershipRules: (
    owners: unknown,
    subType: string,
    isDefault: boolean,
  ) => validateAccountOwnershipRulesMock(owners, subType, isDefault),
}));

const recordUpdateMock = vi.fn();
const recordDeleteMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (args: unknown) => recordUpdateMock(args),
  recordDelete: (args: unknown) => recordDeleteMock(args),
}));

import { PUT, DELETE } from "@/app/api/portal/accounts/[id]/route";

beforeEach(() => {
  requireClientPortalAccessMock.mockReset();
  authErrorResponseMock.mockReset().mockReturnValue(null);
  requireEditEnabledMock.mockReset().mockResolvedValue(undefined);
  updateMock.mockReset();
  deleteAccountsMock.mockReset();
  deleteOwnersMock.mockReset();
  insertOwnerMock.mockReset();
  transactionMock.mockClear();
  validateOwnersShapeMock.mockReset();
  validateOwnersTenantMock.mockReset();
  validateAccountOwnershipRulesMock.mockReset();
  recordUpdateMock.mockReset();
  recordDeleteMock.mockReset();
  accountRow = { id: "acct-1", clientId: "c1", name: "Old", category: "cash", subType: "checking", value: "0", accountNumberLast4: null, plaidItemId: null };
  clientRow = { firmId: "firm-1" };
});

function putReq(body: unknown) {
  return new Request("http://localhost/api/portal/accounts/acct-1", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
function delReq() {
  return new Request("http://localhost/api/portal/accounts/acct-1", { method: "DELETE" });
}
const ctx = { params: Promise.resolve({ id: "acct-1" }) };

describe("PUT /api/portal/accounts/[id]", () => {
  it("404s when account belongs to a different client", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c2", clerkUserId: "u1" });
    const res = await PUT(putReq({ name: "X" }), ctx);
    expect(res.status).toBe(404);
  });

  it("updates editable fields, replaces owners, and records audit", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
    validateOwnersShapeMock.mockReturnValue({
      owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 1 }],
    });
    validateOwnersTenantMock.mockResolvedValue(null);
    validateAccountOwnershipRulesMock.mockReturnValue(null);

    const res = await PUT(
      putReq({
        name: "New",
        category: "cash",
        subType: "checking",
        value: "1234.56",
        last4: "9999",
        owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 1 }],
      }),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      "accounts",
      expect.objectContaining({
        name: "New",
        value: "1234.56",
        accountNumberLast4: "9999",
      }),
    );
    expect(deleteOwnersMock).toHaveBeenCalled();
    expect(insertOwnerMock).toHaveBeenCalledWith(
      "accountOwners",
      expect.objectContaining({
        accountId: "acct-1",
        familyMemberId: "fm1",
        percent: "1",
      }),
    );
    expect(recordUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.account.update",
        resourceType: "account",
        resourceId: "acct-1",
        clientId: "c1",
        firmId: "firm-1",
        actorKind: "client",
      }),
    );
  });

  it("returns 400 when category is not a valid enum value", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
    const res = await PUT(putReq({ category: "not_a_real_category" }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/category/i);
  });
});

describe("DELETE /api/portal/accounts/[id]", () => {
  it("409s when account has a plaid_item_id", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
    accountRow = { ...accountRow!, plaidItemId: "pli_1" };
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(409);
    expect(deleteAccountsMock).not.toHaveBeenCalled();
  });

  it("deletes the account and records audit when manual", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
    const res = await DELETE(delReq(), ctx);
    expect(res.status).toBe(200);
    expect(deleteAccountsMock).toHaveBeenCalled();
    expect(recordDeleteMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.account.delete",
        resourceType: "account",
        resourceId: "acct-1",
        clientId: "c1",
        firmId: "firm-1",
        actorKind: "client",
      }),
    );
  });
});
