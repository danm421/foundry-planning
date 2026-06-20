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

// scenarios.id lookup (base case) — returns one row.
// clients.firmId lookup — returns one row.
// We toggle which "from" call is happening by inspecting the table arg.
const scenarioRows = [{ id: "scenario-base-1" }];
const clientRows = [{ firmId: "firm-1" }];
vi.mock("@/db/schema", () => ({
  scenarios: { _name: "scenarios" },
  clients: { _name: "clients" },
  accounts: { _name: "accounts" },
  accountOwners: { _name: "accountOwners" },
  accountCategoryEnum: { enumValues: ["taxable", "cash", "retirement", "annuity", "real_estate", "business", "life_insurance", "notes_receivable", "stock_options"] },
  accountSubTypeEnum: { enumValues: ["brokerage", "savings", "checking", "traditional_ira", "roth_ira", "401k", "403b", "529", "hsa", "trust", "other", "primary_residence", "rental_property", "commercial_property", "sole_proprietorship", "partnership", "s_corp", "c_corp", "llc", "term", "whole_life"] },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));

const insertAccountValuesMock = vi.fn().mockResolvedValue([{ id: "acct-new" }]);
const insertOwnerValuesMock = vi.fn().mockResolvedValue(undefined);
const txMock = {
  insert: (tbl: { _name: string }) => ({
    values: (v: unknown) => ({
      returning: () => {
        if (tbl._name === "accounts") return insertAccountValuesMock(v);
        throw new Error("unexpected returning() call");
      },
    }),
  }),
};
const txInsertOwner = vi.fn((tbl: { _name: string }) => ({
  values: (v: unknown) => insertOwnerValuesMock(v),
}));
const transactionMock = vi.fn(async (fn: (tx: unknown) => unknown) => {
  // Build a tx where insert(accounts) goes through txMock and insert(accountOwners) goes through txInsertOwner.
  const tx = {
    insert: (tbl: { _name: string }) => {
      if (tbl._name === "accounts") return txMock.insert(tbl);
      return txInsertOwner(tbl);
    },
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

// Ownership validators — keep real-shape passthroughs; we only need to know the route called them.
const validateOwnersShapeMock = vi.fn();
const validateOwnersTenantMock = vi.fn();
const validateAccountOwnershipRulesMock = vi.fn();
vi.mock("@/lib/ownership", () => ({
  validateOwnersShape: (raw: unknown) => validateOwnersShapeMock(raw),
  validateOwnersTenant: (owners: unknown, cid: string) =>
    validateOwnersTenantMock(owners, cid),
  validateAccountOwnershipRules: (
    owners: unknown,
    subType: string,
    isDefault: boolean,
  ) => validateAccountOwnershipRulesMock(owners, subType, isDefault),
}));

const recordCreateMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (args: unknown) => recordCreateMock(args),
}));

import { POST } from "@/app/api/portal/accounts/route";

beforeEach(() => {
  requireClientPortalAccessMock.mockReset();
  authErrorResponseMock.mockReset().mockReturnValue(null);
  requireEditEnabledMock.mockReset();
  insertAccountValuesMock.mockClear();
  insertOwnerValuesMock.mockClear();
  transactionMock.mockClear();
  validateOwnersShapeMock.mockReset();
  validateOwnersTenantMock.mockReset();
  validateAccountOwnershipRulesMock.mockReset();
  recordCreateMock.mockReset();
});

function req(body: unknown): Request {
  return new Request("http://localhost/api/portal/accounts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/portal/accounts", () => {
  it("returns 403 when edit is disabled", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
    requireEditEnabledMock.mockRejectedValue(new ForbiddenError("edit disabled"));
    authErrorResponseMock.mockReturnValue({ body: { error: "Forbidden" }, status: 403 });
    const res = await POST(req({ name: "Checking", category: "cash" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when owners[] is missing or empty", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    validateOwnersShapeMock.mockReturnValue({ error: "owners must have at least one entry" });
    const res = await POST(req({ name: "Checking", category: "cash", owners: [] }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/owners/i);
  });

  it("returns 400 when name is missing", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    const res = await POST(req({ category: "cash", owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 1 }] }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when category is not a valid enum value", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    const res = await POST(
      req({
        name: "Checking",
        category: "not_a_real_category",
        owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 1 }],
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/category/i);
  });

  it("inserts account + owner rows in a transaction and audits", async () => {
    requireClientPortalAccessMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
    requireEditEnabledMock.mockResolvedValue(undefined);
    validateOwnersShapeMock.mockReturnValue({
      owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 1 }],
    });
    validateOwnersTenantMock.mockResolvedValue(null);
    validateAccountOwnershipRulesMock.mockReturnValue(null);

    const res = await POST(
      req({
        name: "Checking",
        last4: "1234",
        category: "cash",
        subType: "checking",
        value: "500.00",
        owners: [{ kind: "family_member", familyMemberId: "fm1", percent: 1 }],
      }),
    );

    expect(res.status).toBe(200);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(insertAccountValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "c1",
        scenarioId: "scenario-base-1",
        name: "Checking",
        category: "cash",
        subType: "checking",
        value: "500.00",
        accountNumberLast4: "1234",
      }),
    );
    expect(insertOwnerValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: "acct-new",
        familyMemberId: "fm1",
        entityId: null,
        percent: "1",
      }),
    );
    expect(recordCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.account.create",
        resourceType: "account",
        resourceId: "acct-new",
        clientId: "c1",
        firmId: "firm-1",
        actorKind: "client",
      }),
    );
  });
});
