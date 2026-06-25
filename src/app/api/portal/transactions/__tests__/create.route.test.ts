/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
const subMock = vi.fn();
const editMock = vi.fn();
const authErrMock = vi.fn();
const recordCreateMock = vi.fn();
const insertReturningMock = vi.fn();

let catRow: any;
let acctRow: any;
let clientRow: any;
let insertedValues: any;

vi.mock("@/lib/portal/resolve-portal-client", () => ({ resolvePortalClient: () => resolveMock() }));
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
vi.mock("@/lib/portal/require-edit-enabled", () => ({ requireEditEnabled: (id: string) => editMock(id) }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({ requirePortalActiveSubscription: (id: string) => subMock(id) }));
vi.mock("@/lib/audit/record-helpers", () => ({ recordCreate: (a: unknown) => recordCreateMock(a) }));
vi.mock("@/db/schema", () => ({
  plaidTransactions: { _name: "plaid_transactions" },
  transactionCategories: { _name: "transaction_categories" },
  accounts: { _name: "accounts" },
  clients: { _name: "clients" },
}));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a, and: (...a: unknown[]) => a }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: (tbl: { _name: string }) => ({ where: () => ({ limit: () => {
      if (tbl._name === "transaction_categories") return Promise.resolve(catRow ? [catRow] : []);
      if (tbl._name === "accounts") return Promise.resolve(acctRow ? [acctRow] : []);
      if (tbl._name === "clients") return Promise.resolve(clientRow ? [clientRow] : []);
      return Promise.resolve([]);
    } }) }) }),
    insert: () => ({ values: (v: any) => { insertedValues = v; return { returning: () => insertReturningMock() }; } }),
  },
}));

import { POST } from "@/app/api/portal/transactions/route";

const postReq = (body: unknown) =>
  new Request("http://localhost/api/portal/transactions", {
    method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" },
  });

beforeEach(() => {
  resolveMock.mockReset(); subMock.mockReset(); editMock.mockReset();
  authErrMock.mockReset(); recordCreateMock.mockReset(); insertReturningMock.mockReset();
  catRow = undefined; acctRow = undefined; clientRow = { firmId: "firm1" };
  insertedValues = undefined;
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client" });
  subMock.mockResolvedValue(undefined); editMock.mockResolvedValue(undefined);
  authErrMock.mockReturnValue(null);
  insertReturningMock.mockResolvedValue([{ id: "txn1" }]);
});

describe("POST /api/portal/transactions", () => {
  it("creates an expense with a positive stored amount", async () => {
    catRow = { id: "l1", clientId: "c1", kind: "category" };
    const res = await POST(postReq({ date: "2026-06-20", amount: 42.5, type: "expense", name: "Cash lunch", categoryId: "l1" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: "txn1" });
    expect(insertedValues).toMatchObject({
      clientId: "c1", source: "manual", plaidItemId: null, plaidAccountId: null,
      plaidTransactionId: null, categorizedBy: "manual", pending: false,
      type: "expense", amount: "42.50", name: "Cash lunch", categoryId: "l1",
    });
    expect(recordCreateMock).toHaveBeenCalled();
  });

  it("stores income negative", async () => {
    const res = await POST(postReq({ date: "2026-06-20", amount: 100, type: "income", name: "Side gig" }));
    expect(res.status).toBe(200);
    expect(insertedValues.amount).toBe("-100.00");
    expect(insertedValues.categoryId).toBeNull();
  });

  it("forces category null for a transfer even if one is sent", async () => {
    catRow = { id: "l1", clientId: "c1", kind: "category" };
    await POST(postReq({ date: "2026-06-20", amount: 10, type: "transfer", name: "Move", categoryId: "l1" }));
    expect(insertedValues.categoryId).toBeNull();
    expect(insertedValues.type).toBe("transfer");
  });

  it("rejects a zero amount", async () => {
    const res = await POST(postReq({ date: "2026-06-20", amount: 0, type: "expense", name: "x" }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing name", async () => {
    const res = await POST(postReq({ date: "2026-06-20", amount: 5, type: "expense", name: "  " }));
    expect(res.status).toBe(400);
  });

  it("rejects a category that belongs to another client", async () => {
    catRow = { id: "l1", clientId: "other", kind: "category" };
    const res = await POST(postReq({ date: "2026-06-20", amount: 5, type: "expense", name: "x", categoryId: "l1" }));
    expect(res.status).toBe(400);
  });
});
