/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { ForbiddenError } = vi.hoisted(() => ({ ForbiddenError: class extends Error {} }));
const resolveMock = vi.fn();
const subMock = vi.fn();
const editMock = vi.fn();
const authErrMock = vi.fn();
const recordCreateMock = vi.fn();
const applyRetroMock = vi.fn();

let catRow: any;
let clientRow: any;
let ruleRows: any[];
const insertReturningMock = vi.fn();

vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) => authErrMock(e),
  ForbiddenError, UnauthorizedError: class extends Error {},
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({ requireEditEnabled: (id: string) => editMock(id) }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({ requirePortalActiveSubscription: (id: string) => subMock(id) }));
vi.mock("@/lib/audit/record-helpers", () => ({ recordCreate: (a: unknown) => recordCreateMock(a) }));
vi.mock("@/lib/portal/recategorize", () => ({ applyRuleRetroactively: (id: string, rule: unknown) => applyRetroMock(id, rule) }));
vi.mock("@/db/schema", () => ({
  transactionRules: { _name: "transaction_rules" },
  transactionCategories: { _name: "transaction_categories" },
  clients: { _name: "clients" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => a,
  desc: (a: unknown) => ({ desc: a }),
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: (tbl: { _name: string }) => ({
      where: () => ({
        limit: () => {
          if (tbl._name === "transaction_categories") return Promise.resolve(catRow ? [catRow] : []);
          if (tbl._name === "clients") return Promise.resolve(clientRow ? [clientRow] : []);
          return Promise.resolve([]);
        },
        orderBy: () => Promise.resolve(ruleRows ?? []),
      }),
    }) }),
    insert: () => ({ values: () => ({ returning: () => insertReturningMock() }) }),
  },
}));

import { GET, POST } from "@/app/api/portal/rules/route";

const postReq = (body: unknown) =>
  new Request("http://localhost/api/portal/rules", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  resolveMock.mockReset();
  subMock.mockReset();
  editMock.mockReset();
  authErrMock.mockReset();
  recordCreateMock.mockReset();
  applyRetroMock.mockReset();
  insertReturningMock.mockReset();

  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  subMock.mockResolvedValue(undefined);
  editMock.mockResolvedValue(undefined);
  catRow = { clientId: "c1", kind: "category" };
  clientRow = { firmId: "firm-1" };
  ruleRows = [
    { id: "rule-1", clientId: "c1", matchType: "contains", pattern: "Uber", categoryId: "cat-1", priority: 100 },
  ];
  insertReturningMock.mockResolvedValue([{ id: "new-rule-id" }]);
  applyRetroMock.mockResolvedValue(4);

  authErrMock.mockImplementation((e: unknown) =>
    e instanceof ForbiddenError
      ? { status: 403, body: { error: (e as Error).message } }
      : null,
  );
});

describe("GET /api/portal/rules", () => {
  it("returns rule list for the client", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0].id).toBe("rule-1");
  });

  it("401 when not authenticated", async () => {
    resolveMock.mockRejectedValue(new Error("Unauthorized"));
    authErrMock.mockReturnValue({ status: 401, body: { error: "Unauthorized" } });
    const res = await GET();
    expect(res.status).toBe(401);
  });
});

describe("POST /api/portal/rules", () => {
  it("creates a rule, applies retroactively, audits portal.rule.create", async () => {
    const res = await POST(postReq({ matchType: "contains", pattern: "Uber", categoryId: "cat-1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("new-rule-id");
    expect(body.applied).toBe(4);
    expect(applyRetroMock).toHaveBeenCalledWith("c1", expect.objectContaining({ matchType: "contains", pattern: "Uber", categoryId: "cat-1" }));
    expect(recordCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "portal.rule.create",
      actorKind: "client",
      clientId: "c1",
      firmId: "firm-1",
    }));
  });

  it("400 when matchType is invalid", async () => {
    const res = await POST(postReq({ matchType: "startsWith", pattern: "Uber", categoryId: "cat-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/matchType/i);
  });

  it("400 when pattern is empty", async () => {
    const res = await POST(postReq({ matchType: "contains", pattern: "   ", categoryId: "cat-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/pattern/i);
  });

  it("400 when pattern is missing", async () => {
    const res = await POST(postReq({ matchType: "exact", categoryId: "cat-1" }));
    expect(res.status).toBe(400);
  });

  it("400 when category is a group (not a leaf)", async () => {
    catRow = { clientId: "c1", kind: "group" };
    const res = await POST(postReq({ matchType: "contains", pattern: "Uber", categoryId: "cat-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/category/i);
  });

  it("400 when category belongs to another client", async () => {
    catRow = { clientId: "other-client", kind: "category" };
    const res = await POST(postReq({ matchType: "contains", pattern: "Uber", categoryId: "cat-1" }));
    expect(res.status).toBe(400);
  });

  it("400 when categoryId is missing", async () => {
    const res = await POST(postReq({ matchType: "contains", pattern: "Uber" }));
    expect(res.status).toBe(400);
  });

  it("403 when subscription is inactive", async () => {
    subMock.mockRejectedValue(new ForbiddenError("Active subscription required"));
    const res = await POST(postReq({ matchType: "contains", pattern: "Uber", categoryId: "cat-1" }));
    expect(res.status).toBe(403);
    expect(insertReturningMock).not.toHaveBeenCalled();
    expect(applyRetroMock).not.toHaveBeenCalled();
  });

  it("403 when edit is disabled", async () => {
    editMock.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await POST(postReq({ matchType: "contains", pattern: "Uber", categoryId: "cat-1" }));
    expect(res.status).toBe(403);
    expect(insertReturningMock).not.toHaveBeenCalled();
  });
});
