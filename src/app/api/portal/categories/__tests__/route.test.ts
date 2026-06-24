/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { ForbiddenError } = vi.hoisted(() => ({ ForbiddenError: class extends Error {} }));
const resolveMock = vi.fn();
const subMock = vi.fn();
const editMock = vi.fn();
const authErrMock = vi.fn();
const recordCreateMock = vi.fn();
const recordUpdateMock = vi.fn();
const recordDeleteMock = vi.fn();
const seedMock = vi.fn();

let catRow: any;       // the category being targeted (by id)
let parentRow: any;    // parent category lookup for POST
let targetRow: any;    // reassignToId target for DELETE
let clientRow: any;
let allCategories: any[];
const insertReturningMock = vi.fn();
const updateMock = vi.fn();
const deleteMock = vi.fn();
const txUpdateMock = vi.fn();
const txDeleteMock = vi.fn();

vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) => authErrMock(e),
  ForbiddenError, UnauthorizedError: class extends Error {},
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({ requireEditEnabled: (id: string) => editMock(id) }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({ requirePortalActiveSubscription: (id: string) => subMock(id) }));
vi.mock("@/lib/audit/record-helpers", () => ({
  recordCreate: (a: unknown) => recordCreateMock(a),
  recordUpdate: (a: unknown) => recordUpdateMock(a),
  recordDelete: (a: unknown) => recordDeleteMock(a),
}));
vi.mock("@/lib/portal/seed-categories", () => ({ ensureCategoriesSeeded: (id: string) => seedMock(id) }));

vi.mock("@/db/schema", () => ({
  transactionCategories: { _name: "transaction_categories" },
  plaidTransactions: { _name: "plaid_transactions" },
  clients: { _name: "clients" },
}));
vi.mock("drizzle-orm", () => ({
  eq: (...a: unknown[]) => a,
}));

// selectCallCount tracks which call maps to which row (catRow vs parentRow/targetRow vs clientRow)
// For [id]/route.ts selects: first call is catRow (the main category), second call varies by flow
// For route.ts POST: first call is parentRow, second call is clientRow
// We use a call counter approach per test via a closure
let selectCallCount = 0;

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (tbl: { _name: string }) => ({
        where: () => ({
          limit: () => {
            selectCallCount++;
            if (tbl._name === "clients") return Promise.resolve(clientRow ? [clientRow] : []);
            if (tbl._name === "transaction_categories") {
              // First select on transaction_categories = the main row (catRow)
              // Subsequent selects in same request = parentRow (POST) or targetRow (DELETE)
              if (selectCallCount === 1) return Promise.resolve(catRow ? [catRow] : []);
              return Promise.resolve(targetRow ? [targetRow] : []);
            }
            return Promise.resolve([]);
          },
          orderBy: () => Promise.resolve(allCategories ?? []),
        }),
        orderBy: () => Promise.resolve(allCategories ?? []),
      }),
    }),
    insert: () => ({ values: () => ({ returning: () => insertReturningMock() }) }),
    update: () => ({ set: (v: unknown) => ({ where: () => updateMock(v) }) }),
    delete: () => ({ where: () => deleteMock() }),
    transaction: async (fn: (tx: any) => Promise<void>) => {
      const tx = {
        update: () => ({ set: (v: unknown) => ({ where: () => txUpdateMock(v) }) }),
        delete: () => ({ where: () => txDeleteMock() }),
      };
      return fn(tx);
    },
  },
}));

import { GET, POST } from "@/app/api/portal/categories/route";
import { PUT, DELETE } from "@/app/api/portal/categories/[id]/route";

const idCtx = (id: string) => ({ params: Promise.resolve({ id }) });

const postReq = (body: unknown) =>
  new Request("http://localhost/api/portal/categories", {
    method: "POST", body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const putReq = (body: unknown) =>
  new Request("http://localhost/api/portal/categories/cat-1", {
    method: "PUT", body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

const deleteReq = (body: unknown = {}) =>
  new Request("http://localhost/api/portal/categories/cat-1", {
    method: "DELETE", body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  resolveMock.mockReset(); subMock.mockReset(); editMock.mockReset();
  authErrMock.mockReset(); recordCreateMock.mockReset(); recordUpdateMock.mockReset();
  recordDeleteMock.mockReset(); seedMock.mockReset(); insertReturningMock.mockReset();
  updateMock.mockReset(); deleteMock.mockReset(); txUpdateMock.mockReset(); txDeleteMock.mockReset();
  selectCallCount = 0;

  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  subMock.mockResolvedValue(undefined);
  editMock.mockResolvedValue(undefined);
  seedMock.mockResolvedValue(undefined);
  clientRow = { firmId: "firm-1" };
  allCategories = [
    { id: "group-1", clientId: "c1", name: "Food", kind: "group", sortOrder: 1 },
    { id: "cat-1", clientId: "c1", name: "Groceries", kind: "category", sortOrder: 2 },
  ];
  catRow = { id: "cat-1", clientId: "c1", name: "Groceries", kind: "category", isSystem: false, color: "#aaa", sortOrder: 10 };
  parentRow = { id: "group-1", clientId: "c1", kind: "group" };
  targetRow = { id: "cat-2", clientId: "c1", kind: "category" };
  insertReturningMock.mockResolvedValue([{ id: "new-cat-id" }]);
  updateMock.mockResolvedValue(undefined);
  deleteMock.mockResolvedValue(undefined);
  txUpdateMock.mockResolvedValue(undefined);
  txDeleteMock.mockResolvedValue(undefined);

  authErrMock.mockImplementation((e: unknown) =>
    e instanceof ForbiddenError
      ? { status: 403, body: { error: (e as Error).message } }
      : null,
  );
});

// ─── GET ────────────────────────────────────────────────────────────────────

describe("GET /api/portal/categories", () => {
  it("seeds then returns categories ordered by sortOrder", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(seedMock).toHaveBeenCalledWith("c1");
    const body = await res.json();
    expect(body.categories).toHaveLength(2);
    expect(body.categories[0].id).toBe("group-1");
    expect(body.categories[1].id).toBe("cat-1");
  });

  it("401 when not authenticated", async () => {
    resolveMock.mockRejectedValue(new Error("Unauthorized"));
    authErrMock.mockReturnValue({ status: 401, body: { error: "Unauthorized" } });
    const res = await GET();
    expect(res.status).toBe(401);
    expect(seedMock).not.toHaveBeenCalled();
  });
});

// ─── POST ───────────────────────────────────────────────────────────────────

describe("POST /api/portal/categories", () => {
  it("creates a user leaf category and audits portal.category.create", async () => {
    // For POST category: first select on tx_categories = parentRow, then clients
    // Override selectCallCount behavior: parentRow returned on first call
    catRow = parentRow; // first call returns parentRow for parent lookup
    const res = await POST(postReq({ name: "Restaurants", kind: "category", parentId: "group-1", color: "#ff0000" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("new-cat-id");
    expect(recordCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "portal.category.create",
      actorKind: "client",
      clientId: "c1",
      firmId: "firm-1",
    }));
  });

  it("creates a user group and audits portal.category.create", async () => {
    const res = await POST(postReq({ name: "Entertainment", kind: "group" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("new-cat-id");
    expect(recordCreateMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "portal.category.create",
      actorKind: "client",
    }));
  });

  it("400 when name is blank", async () => {
    const res = await POST(postReq({ name: "  ", kind: "category", parentId: "group-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/name/i);
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it("400 when name is missing", async () => {
    const res = await POST(postReq({ kind: "group" }));
    expect(res.status).toBe(400);
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it("400 when kind is invalid", async () => {
    const res = await POST(postReq({ name: "Test", kind: "leaf" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/kind/i);
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it("400 when category kind missing parentId", async () => {
    const res = await POST(postReq({ name: "Test", kind: "category" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/parentId/i);
  });

  it("400 when parent is a category (not a group)", async () => {
    catRow = { id: "group-1", clientId: "c1", kind: "category" }; // parent is wrong kind
    const res = await POST(postReq({ name: "Test", kind: "category", parentId: "group-1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/parent/i);
  });

  it("400 when parent belongs to another client", async () => {
    catRow = { id: "group-1", clientId: "other", kind: "group" };
    const res = await POST(postReq({ name: "Test", kind: "category", parentId: "group-1" }));
    expect(res.status).toBe(400);
  });

  it("403 when subscription is inactive", async () => {
    subMock.mockRejectedValue(new ForbiddenError("Active subscription required"));
    const res = await POST(postReq({ name: "Test", kind: "group" }));
    expect(res.status).toBe(403);
    expect(insertReturningMock).not.toHaveBeenCalled();
  });

  it("403 when edit is disabled", async () => {
    editMock.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await POST(postReq({ name: "Test", kind: "group" }));
    expect(res.status).toBe(403);
    expect(insertReturningMock).not.toHaveBeenCalled();
  });
});

// ─── PUT ────────────────────────────────────────────────────────────────────

describe("PUT /api/portal/categories/[id]", () => {
  it("renames a category and audits portal.category.update", async () => {
    const res = await PUT(putReq({ name: "Supermarkets" }), idCtx("cat-1"));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ name: "Supermarkets" }));
    expect(recordUpdateMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "portal.category.update",
      actorKind: "client",
      clientId: "c1",
      firmId: "firm-1",
    }));
  });

  it("recolors a category", async () => {
    const res = await PUT(putReq({ color: "#00ff00" }), idCtx("cat-1"));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ color: "#00ff00" }));
  });

  it("updates sortOrder", async () => {
    const res = await PUT(putReq({ sortOrder: 5 }), idCtx("cat-1"));
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 5 }));
  });

  it("404 when category belongs to another client", async () => {
    catRow = { id: "cat-1", clientId: "other", name: "X", kind: "category", isSystem: false, color: "#aaa", sortOrder: 10 };
    const res = await PUT(putReq({ name: "New" }), idCtx("cat-1"));
    expect(res.status).toBe(404);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("404 when category does not exist", async () => {
    catRow = null;
    const res = await PUT(putReq({ name: "New" }), idCtx("cat-1"));
    expect(res.status).toBe(404);
  });

  it("403 when subscription is inactive", async () => {
    subMock.mockRejectedValue(new ForbiddenError("Active subscription required"));
    const res = await PUT(putReq({ name: "Test" }), idCtx("cat-1"));
    expect(res.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("403 when edit is disabled", async () => {
    editMock.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await PUT(putReq({ name: "Test" }), idCtx("cat-1"));
    expect(res.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

// ─── DELETE ─────────────────────────────────────────────────────────────────

describe("DELETE /api/portal/categories/[id]", () => {
  it("reassigns transactions to reassignToId then deletes, audits portal.category.delete", async () => {
    // DELETE flow: first select = catRow (the row to delete), second select = targetRow (reassign target), third = clientRow
    // targetRow is set in beforeEach as a valid category
    const res = await DELETE(deleteReq({ reassignToId: "cat-2" }), idCtx("cat-1"));
    expect(res.status).toBe(200);
    // db.transaction was called: transactions updated, then category deleted
    expect(txUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ categoryId: "cat-2" }));
    expect(txDeleteMock).toHaveBeenCalled();
    expect(recordDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "portal.category.delete",
      actorKind: "client",
      clientId: "c1",
      firmId: "firm-1",
    }));
  });

  it("deletes with null reassignToId (unassign transactions)", async () => {
    const res = await DELETE(deleteReq({ reassignToId: null }), idCtx("cat-1"));
    expect(res.status).toBe(200);
    expect(txUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ categoryId: null }));
    expect(txDeleteMock).toHaveBeenCalled();
    expect(recordDeleteMock).toHaveBeenCalled();
  });

  it("400 when trying to delete a system category", async () => {
    catRow = { id: "cat-1", clientId: "c1", name: "Groceries", kind: "category", isSystem: true, color: "#aaa", sortOrder: 10 };
    const res = await DELETE(deleteReq(), idCtx("cat-1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/can't be deleted/i);
    expect(txDeleteMock).not.toHaveBeenCalled();
  });

  it("404 when category belongs to another client", async () => {
    catRow = { id: "cat-1", clientId: "other", name: "X", kind: "category", isSystem: false, color: "#aaa", sortOrder: 10 };
    const res = await DELETE(deleteReq(), idCtx("cat-1"));
    expect(res.status).toBe(404);
    expect(txDeleteMock).not.toHaveBeenCalled();
  });

  it("404 when category does not exist", async () => {
    catRow = null;
    const res = await DELETE(deleteReq(), idCtx("cat-1"));
    expect(res.status).toBe(404);
  });

  it("400 when reassignToId is a group (not a leaf)", async () => {
    targetRow = { id: "cat-2", clientId: "c1", kind: "group" };
    const res = await DELETE(deleteReq({ reassignToId: "cat-2" }), idCtx("cat-1"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/reassign target/i);
    expect(txDeleteMock).not.toHaveBeenCalled();
  });

  it("400 when reassignToId belongs to another client", async () => {
    targetRow = { id: "cat-2", clientId: "other", kind: "category" };
    const res = await DELETE(deleteReq({ reassignToId: "cat-2" }), idCtx("cat-1"));
    expect(res.status).toBe(400);
    expect(txDeleteMock).not.toHaveBeenCalled();
  });

  it("400 when reassignToId does not exist", async () => {
    targetRow = null;
    const res = await DELETE(deleteReq({ reassignToId: "nonexistent" }), idCtx("cat-1"));
    expect(res.status).toBe(400);
    expect(txDeleteMock).not.toHaveBeenCalled();
  });

  it("403 when subscription is inactive", async () => {
    subMock.mockRejectedValue(new ForbiddenError("Active subscription required"));
    const res = await DELETE(deleteReq(), idCtx("cat-1"));
    expect(res.status).toBe(403);
    expect(txDeleteMock).not.toHaveBeenCalled();
  });

  it("403 when edit is disabled", async () => {
    editMock.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await DELETE(deleteReq(), idCtx("cat-1"));
    expect(res.status).toBe(403);
    expect(txDeleteMock).not.toHaveBeenCalled();
  });
});
