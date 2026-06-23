/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
const { ForbiddenError } = vi.hoisted(() => ({ ForbiddenError: class extends Error {} }));
const requireMock = vi.fn();
const subMock = vi.fn();
const editMock = vi.fn();
const authErrMock = vi.fn();
const recordUpdateMock = vi.fn();
let txnRow: any; let catRow: any; let clientRow: any; const updateMock = vi.fn();

vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: () => requireMock(),
  authErrorResponse: (e: unknown) => authErrMock(e),
  ForbiddenError, UnauthorizedError: class extends Error {},
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({ requireEditEnabled: (id: string) => editMock(id) }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({ requirePortalActiveSubscription: (id: string) => subMock(id) }));
vi.mock("@/lib/audit/record-helpers", () => ({ recordUpdate: (a: unknown) => recordUpdateMock(a) }));
vi.mock("@/db/schema", () => ({
  plaidTransactions: { _name: "plaid_transactions" },
  transactionCategories: { _name: "transaction_categories" },
  clients: { _name: "clients" },
}));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (...a: unknown[]) => a }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: (tbl: { _name: string }) => ({ where: () => ({ limit: () => {
      if (tbl._name === "plaid_transactions") return Promise.resolve(txnRow ? [txnRow] : []);
      if (tbl._name === "transaction_categories") return Promise.resolve(catRow ? [catRow] : []);
      if (tbl._name === "clients") return Promise.resolve(clientRow ? [clientRow] : []);
      return Promise.resolve([]);
    } }) }) }),
    update: () => ({ set: (v: unknown) => ({ where: () => updateMock(v) }) }),
  },
}));
import { PUT } from "@/app/api/portal/transactions/[id]/route";

const ctx = { params: Promise.resolve({ id: "t1" }) };
const putReq = (body: unknown) => new Request("http://localhost/api/portal/transactions/t1", { method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  requireMock.mockReset(); subMock.mockReset(); editMock.mockReset(); authErrMock.mockReset();
  recordUpdateMock.mockReset(); updateMock.mockReset();
  requireMock.mockResolvedValue({ clientId: "c1", clerkUserId: "u1" });
  subMock.mockResolvedValue(undefined); editMock.mockResolvedValue(undefined);
  txnRow = { id: "t1", clientId: "c1", categoryId: null, categorizedBy: "plaid", excluded: false };
  catRow = { id: "cat-1", clientId: "c1", kind: "category" };
  clientRow = { firmId: "firm-1" };
  authErrMock.mockImplementation((e: unknown) => e instanceof ForbiddenError ? { status: 403, body: { error: (e as Error).message } } : null);
});

describe("PUT /api/portal/transactions/[id]", () => {
  it("sets category and marks categorizedBy manual + audits", async () => {
    const res = await PUT(putReq({ categoryId: "cat-1" }), ctx);
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0]).toMatchObject({ categoryId: "cat-1", categorizedBy: "manual" });
    expect(recordUpdateMock.mock.calls[0][0]).toMatchObject({ action: "portal.transaction.update", actorKind: "client", firmId: "firm-1", clientId: "c1" });
  });
  it("toggles excluded", async () => {
    const res = await PUT(putReq({ excluded: true }), ctx);
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0]).toMatchObject({ excluded: true });
  });
  it("403 when subscription inactive", async () => {
    subMock.mockRejectedValue(new ForbiddenError("Active subscription required"));
    const res = await PUT(putReq({ excluded: true }), ctx);
    expect(res.status).toBe(403);
    expect(updateMock).not.toHaveBeenCalled();
  });
  it("403 when edit disabled", async () => {
    editMock.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await PUT(putReq({ excluded: true }), ctx);
    expect(res.status).toBe(403);
  });
  it("404 when the transaction belongs to another client", async () => {
    txnRow = { id: "t1", clientId: "other", categoryId: null, categorizedBy: "plaid", excluded: false };
    const res = await PUT(putReq({ excluded: true }), ctx);
    expect(res.status).toBe(404);
  });
  it("400 when categoryId is a group (not a leaf)", async () => {
    catRow = { id: "cat-1", clientId: "c1", kind: "group" };
    const res = await PUT(putReq({ categoryId: "cat-1" }), ctx);
    expect(res.status).toBe(400);
  });
  it("400 when categoryId belongs to another client", async () => {
    catRow = { id: "cat-1", clientId: "other", kind: "category" };
    const res = await PUT(putReq({ categoryId: "cat-1" }), ctx);
    expect(res.status).toBe(400);
  });
  it("rejects an invalid type with 400", async () => {
    const res = await PUT(
      new Request("http://t/api/portal/transactions/t1", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "bogus" }),
      }),
      { params: Promise.resolve({ id: "t1" }) },
    );
    expect(res.status).toBe(400);
  });
  it("setting type=transfer nulls the category in the patch", async () => {
    txnRow = { id: "t1", clientId: "c1", categoryId: "cat-1", categorizedBy: "manual", excluded: false, recurringTransactionId: null, type: "expense" };
    const res = await PUT(
      new Request("http://t/api/portal/transactions/t1", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "transfer" }),
      }),
      { params: Promise.resolve({ id: "t1" }) },
    );
    expect(res.status).toBe(200);
    expect(updateMock.mock.calls[0][0]).toMatchObject({ type: "transfer", categoryId: null, categorizedBy: "manual" });
  });
});
