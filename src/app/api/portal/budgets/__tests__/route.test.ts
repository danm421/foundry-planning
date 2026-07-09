// src/app/api/portal/budgets/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolvePortalClientMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolvePortalClientMock(),
}));
const authErrorResponseMock = vi.fn<
  (e: unknown) => { status: number; body: { error: string } } | null
>(() => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrorResponseMock(e) }));
const requireEditEnabledMock = vi.fn();
vi.mock("@/lib/portal/require-edit-enabled", () => ({
  requireEditEnabled: (id: string) => requireEditEnabledMock(id),
}));
const requirePortalActiveSubscriptionMock = vi.fn();
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: (id: string) => requirePortalActiveSubscriptionMock(id),
}));
const recordUpdateMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (a: unknown) => recordUpdateMock(a),
}));
const areaSharedMock = vi.fn();
vi.mock("@/lib/portal/privacy", () => ({
  requireAreaShared: (...a: unknown[]) => areaSharedMock(...a),
}));
const loadBudgetMock = vi.fn();
vi.mock("@/lib/portal/load-budget-data", () => ({
  loadBudgetSummary: (...a: unknown[]) => loadBudgetMock(...a),
}));
vi.mock("@/db/schema", () => ({
  budgets: { _name: "budgets", categoryId: "category_id" },
  transactionCategories: { _name: "transactionCategories" },
  clients: { _name: "clients" },
}));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));

// db mock: select() returns queued rows per call; insert()/delete() record calls.
const selectQueue: unknown[][] = [];
const insertValuesMock = vi.fn();
const onConflictMock = vi.fn();
const deleteWhereMock = vi.fn();
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(selectQueue.shift() ?? []) }) }),
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertValuesMock(v);
        return { onConflictDoUpdate: (c: unknown) => { onConflictMock(c); return Promise.resolve(); } };
      },
    }),
    delete: () => ({ where: (w: unknown) => { deleteWhereMock(w); return Promise.resolve(); } }),
  },
}));

import { GET, PUT } from "@/app/api/portal/budgets/route";

function req(body: unknown): Request {
  return new Request("http://t/api/portal/budgets", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  selectQueue.length = 0;
  insertValuesMock.mockClear();
  onConflictMock.mockClear();
  deleteWhereMock.mockClear();
  recordUpdateMock.mockClear();
  resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "client" });
  requirePortalActiveSubscriptionMock.mockResolvedValue(undefined);
  requireEditEnabledMock.mockResolvedValue(undefined);
  areaSharedMock.mockReset();
  areaSharedMock.mockResolvedValue(undefined);
  loadBudgetMock.mockReset();
  loadBudgetMock.mockResolvedValue({
    groups: [], totalBudget: 0, totalSpent: 100, totalRemaining: -100, incomeThisMonth: 0, month: "2026-07",
  });
});

it("upserts a budget for an expense leaf", async () => {
  // 1) category lookup → an expense leaf under a non-income parent
  selectQueue.push([{ id: "leaf-1", clientId: "c1", parentId: "grp-1", slug: "food-groceries" }]);
  // 2) parent lookup → non-income group slug
  selectQueue.push([{ slug: "food" }]);
  // 3) clients.firmId
  selectQueue.push([{ firmId: "firm-1" }]);
  // 4) existing budget → none
  selectQueue.push([]);
  const res = await PUT(req({ categoryId: "leaf-1", monthlyAmount: 250 }));
  expect(res.status).toBe(200);
  expect(insertValuesMock).toHaveBeenCalledWith(
    expect.objectContaining({ clientId: "c1", categoryId: "leaf-1", monthlyAmount: "250.00" }),
  );
  expect(onConflictMock).toHaveBeenCalled();
  expect(recordUpdateMock).toHaveBeenCalledWith(
    expect.objectContaining({ action: "portal.budget.update", resourceId: "leaf-1" }),
  );
});

it("clears the budget when amount is null", async () => {
  selectQueue.push([{ id: "g-1", clientId: "c1", parentId: null, slug: "food" }]);
  selectQueue.push([{ firmId: "firm-1" }]); // no parent lookup (parentId null)
  selectQueue.push([{ monthlyAmount: "100.00" }]); // existing
  const res = await PUT(req({ categoryId: "g-1", monthlyAmount: null }));
  const json = await res.json();
  expect(res.status).toBe(200);
  expect(json.cleared).toBe(true);
  expect(deleteWhereMock).toHaveBeenCalled();
  expect(insertValuesMock).not.toHaveBeenCalled();
});

it("rejects a category that isn't the client's (404)", async () => {
  selectQueue.push([{ id: "x", clientId: "other", parentId: null, slug: "food" }]);
  const res = await PUT(req({ categoryId: "x", monthlyAmount: 100 }));
  expect(res.status).toBe(404);
});

it("rejects budgeting an income category (400)", async () => {
  selectQueue.push([{ id: "l-pay", clientId: "c1", parentId: "g-income", slug: "income-paycheck" }]);
  selectQueue.push([{ slug: "income" }]); // parent is income group
  const res = await PUT(req({ categoryId: "l-pay", monthlyAmount: 100 }));
  expect(res.status).toBe(400);
  expect(insertValuesMock).not.toHaveBeenCalled();
});

it("400s when categoryId is missing", async () => {
  const res = await PUT(req({ monthlyAmount: 100 }));
  expect(res.status).toBe(400);
});

it("attributes the audit to the advisor with viaPreview when mode is advisor", async () => {
  resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "advisor" });
  selectQueue.push([{ id: "leaf-1", clientId: "c1", parentId: "grp-1", slug: "food-groceries" }]);
  selectQueue.push([{ slug: "food" }]);
  selectQueue.push([{ firmId: "firm-1" }]);
  selectQueue.push([]);
  const res = await PUT(req({ categoryId: "leaf-1", monthlyAmount: 250 }));
  expect(res.status).toBe(200);
  expect(recordUpdateMock).toHaveBeenCalledWith(
    expect.objectContaining({ actorKind: "advisor", extraMetadata: { viaPreview: true } }),
  );
  expect(areaSharedMock).toHaveBeenCalledWith("advisor", "c1", "budgets");
});

it("rejects the advisor when the client has not shared budgets (403)", async () => {
  resolvePortalClientMock.mockResolvedValue({ clientId: "c1", mode: "advisor" });
  const forbidden = new Error("not shared");
  areaSharedMock.mockRejectedValue(forbidden);
  authErrorResponseMock.mockImplementation((e: unknown) =>
    e === forbidden ? { status: 403, body: { error: "not shared" } } : null,
  );
  const res = await PUT(req({ categoryId: "leaf-1", monthlyAmount: 250 }));
  expect(res.status).toBe(403);
  expect(insertValuesMock).not.toHaveBeenCalled();
  authErrorResponseMock.mockImplementation(() => null);
});

describe("GET /api/portal/budgets", () => {
  it("returns the current-month budget summary, gated on the budgets area", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.month).toBe("2026-07");
    expect(body.totalSpent).toBe(100);
    expect(areaSharedMock).toHaveBeenCalledWith("client", "c1", "budgets");
    expect(loadBudgetMock).toHaveBeenCalledWith("c1", expect.any(Date));
  });

  it("propagates auth errors (e.g. advisor preview with budgets off)", async () => {
    areaSharedMock.mockRejectedValue(new Error("forbidden"));
    authErrorResponseMock.mockReturnValue({ status: 403, body: { error: "forbidden" } });
    const res = await GET();
    expect(res.status).toBe(403);
  });
});
