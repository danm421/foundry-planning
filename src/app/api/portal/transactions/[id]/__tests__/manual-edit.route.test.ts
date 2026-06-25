/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
const subMock = vi.fn();
const editMock = vi.fn();
const authErrMock = vi.fn();
const recordUpdateMock = vi.fn();
const recordDeleteMock = vi.fn();

let txnRow: any;
let clientRow: any;
let acctRow: any;
let updateSet: any;
let deleted = false;

vi.mock("@/lib/portal/resolve-portal-client", () => ({ resolvePortalClient: () => resolveMock() }));
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
vi.mock("@/lib/portal/require-edit-enabled", () => ({ requireEditEnabled: (id: string) => editMock(id) }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({ requirePortalActiveSubscription: (id: string) => subMock(id) }));
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (a: unknown) => recordUpdateMock(a),
  recordDelete: (a: unknown) => recordDeleteMock(a),
}));
vi.mock("@/db/schema", () => ({
  plaidTransactions: { _name: "plaid_transactions" },
  transactionCategories: { _name: "transaction_categories" },
  recurringTransactions: { _name: "recurring_transactions" },
  accounts: { _name: "accounts" },
  clients: { _name: "clients" },
}));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: (tbl: { _name: string }) => ({ where: () => ({ limit: () => {
      if (tbl._name === "plaid_transactions") return Promise.resolve(txnRow ? [txnRow] : []);
      if (tbl._name === "clients") return Promise.resolve(clientRow ? [clientRow] : []);
      if (tbl._name === "accounts") return Promise.resolve(acctRow ? [acctRow] : []);
      return Promise.resolve([]);
    } }) }) }),
    update: () => ({ set: (v: any) => { updateSet = v; return { where: () => Promise.resolve() }; } }),
    delete: () => ({ where: () => { deleted = true; return Promise.resolve(); } }),
  },
}));

import { PUT, DELETE } from "@/app/api/portal/transactions/[id]/route";

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const putReq = (body: unknown) =>
  new Request("http://localhost/api/portal/transactions/x", {
    method: "PUT", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });
const delReq = () => new Request("http://localhost/api/portal/transactions/x", { method: "DELETE" });

beforeEach(() => {
  resolveMock.mockReset(); subMock.mockReset(); editMock.mockReset();
  authErrMock.mockReset(); recordUpdateMock.mockReset(); recordDeleteMock.mockReset();
  updateSet = undefined; deleted = false; clientRow = { firmId: "firm1" };
  acctRow = undefined;
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client" });
  subMock.mockResolvedValue(undefined); editMock.mockResolvedValue(undefined);
  authErrMock.mockReturnValue(null);
});

describe("PUT manual edits", () => {
  it("edits amount/date/name on a manual row and re-encodes the sign", async () => {
    txnRow = { id: "t1", clientId: "c1", source: "manual", type: "expense", amount: "10.00", date: "2026-01-01", name: "old", accountId: null, categoryId: null, categorizedBy: "manual", excluded: false, recurringTransactionId: null };
    const res = await PUT(putReq({ amount: 75, date: "2026-06-01", name: "New name" }), ctx("t1"));
    expect(res.status).toBe(200);
    expect(updateSet).toMatchObject({ amount: "75.00", date: "2026-06-01", name: "New name" });
  });

  it("re-encodes the existing magnitude when only the type flips on a manual row", async () => {
    txnRow = { id: "t1", clientId: "c1", source: "manual", type: "expense", amount: "40.00", date: "2026-01-01", name: "x", accountId: null, categoryId: null, categorizedBy: "manual", excluded: false, recurringTransactionId: null };
    const res = await PUT(putReq({ type: "income" }), ctx("t1"));
    expect(res.status).toBe(200);
    expect(updateSet.amount).toBe("-40.00");
    expect(updateSet.type).toBe("income");
  });

  it("rejects amount/date/name edits on a synced (plaid) row", async () => {
    txnRow = { id: "t1", clientId: "c1", source: "plaid", type: "expense", amount: "10.00", date: "2026-01-01", name: "x", accountId: null, categoryId: null, categorizedBy: "plaid", excluded: false, recurringTransactionId: null };
    const res = await PUT(putReq({ amount: 99 }), ctx("t1"));
    expect(res.status).toBe(400);
  });

  it("reassigns accountId on a manual row when the account belongs to the same client", async () => {
    txnRow = { id: "t1", clientId: "c1", source: "manual", type: "expense", amount: "10.00", date: "2026-01-01", name: "x", accountId: null, categoryId: null, categorizedBy: "manual", excluded: false, recurringTransactionId: null };
    acctRow = { clientId: "c1" };
    const res = await PUT(putReq({ accountId: "acct-abc" }), ctx("t1"));
    expect(res.status).toBe(200);
    expect(updateSet.accountId).toBe("acct-abc");
    expect(recordUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ actorKind: "client" }));
  });

  it("rejects accountId that belongs to a different client", async () => {
    txnRow = { id: "t1", clientId: "c1", source: "manual", type: "expense", amount: "10.00", date: "2026-01-01", name: "x", accountId: null, categoryId: null, categorizedBy: "manual", excluded: false, recurringTransactionId: null };
    acctRow = { clientId: "other-client" };
    const res = await PUT(putReq({ accountId: "acct-xyz" }), ctx("t1"));
    expect(res.status).toBe(400);
    expect(updateSet).toBeUndefined();
  });
});

describe("DELETE", () => {
  it("deletes a manual row", async () => {
    txnRow = { id: "t1", clientId: "c1", source: "manual", name: "x", amount: "10.00", date: "2026-01-01" };
    const res = await DELETE(delReq(), ctx("t1"));
    expect(res.status).toBe(200);
    expect(deleted).toBe(true);
    expect(recordDeleteMock).toHaveBeenCalled();
    expect(recordDeleteMock).toHaveBeenCalledWith(expect.objectContaining({ action: "portal.transaction.delete", actorKind: "client", extraMetadata: undefined }));
  });

  it("refuses to delete a synced (plaid) row", async () => {
    txnRow = { id: "t1", clientId: "c1", source: "plaid", name: "x", amount: "10.00", date: "2026-01-01" };
    const res = await DELETE(delReq(), ctx("t1"));
    expect(res.status).toBe(400);
    expect(deleted).toBe(false);
  });
});
