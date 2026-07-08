/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
const { ForbiddenError } = vi.hoisted(() => ({ ForbiddenError: class extends Error {} }));
const resolveMock = vi.fn();
const subMock = vi.fn();
const editMock = vi.fn();
const authErrMock = vi.fn();
const recordUpdateMock = vi.fn();
const areaSharedMock = vi.fn();
let clientRow: any;
let updatedRows: Array<{ id: string }>;
const setMock = vi.fn();

vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
vi.mock("@/lib/authz", () => ({
  authErrorResponse: (e: unknown) => authErrMock(e),
  ForbiddenError,
  UnauthorizedError: class extends Error {},
}));
vi.mock("@/lib/portal/require-edit-enabled", () => ({ requireEditEnabled: (id: string) => editMock(id) }));
vi.mock("@/lib/portal/require-portal-subscription", () => ({ requirePortalActiveSubscription: (id: string) => subMock(id) }));
vi.mock("@/lib/audit/record-helpers", () => ({ recordUpdate: (a: unknown) => recordUpdateMock(a) }));
vi.mock("@/lib/portal/privacy", () => ({ requireAreaShared: (...a: unknown[]) => areaSharedMock(...a) }));
vi.mock("@/db/schema", () => ({
  plaidTransactions: { _name: "plaid_transactions" },
  clients: { _name: "clients" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  isNull: (...a: unknown[]) => a,
  ne: (...a: unknown[]) => a,
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(clientRow ? [clientRow] : []) }) }) }),
    update: () => ({ set: (v: unknown) => { setMock(v); return { where: () => ({ returning: () => Promise.resolve(updatedRows) }) }; } }),
  },
}));
import { POST } from "@/app/api/portal/transactions/review-all/route";

beforeEach(() => {
  resolveMock.mockReset(); subMock.mockReset(); editMock.mockReset(); authErrMock.mockReset();
  recordUpdateMock.mockReset(); areaSharedMock.mockReset(); setMock.mockReset();
  areaSharedMock.mockResolvedValue(undefined);
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  subMock.mockResolvedValue(undefined); editMock.mockResolvedValue(undefined);
  clientRow = { firmId: "firm-1" };
  updatedRows = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
  authErrMock.mockImplementation((e: unknown) =>
    e instanceof ForbiddenError ? { status: 403, body: { error: (e as Error).message } } : null,
  );
});

describe("POST /api/portal/transactions/review-all", () => {
  it("stamps reviewedAt/reviewedBy and returns the cleared count + audits", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 3 });
    const patch = setMock.mock.calls[0][0];
    expect(patch.reviewedAt).toBeInstanceOf(Date);
    expect(patch.reviewedBy).toBe("u1");
    expect(recordUpdateMock.mock.calls[0][0]).toMatchObject({
      action: "portal.transaction.review_all",
      actorKind: "client",
      firmId: "firm-1",
      clientId: "c1",
      extraMetadata: { count: 3 },
    });
  });

  it("does not audit when nothing was unreviewed", async () => {
    updatedRows = [];
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 0 });
    expect(recordUpdateMock).not.toHaveBeenCalled();
  });

  it("advisor act-as preview audits as advisor with viaPreview", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "advisor-1" });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(recordUpdateMock.mock.calls[0][0]).toMatchObject({
      actorKind: "advisor",
      extraMetadata: { count: 3, viaPreview: true },
    });
  });

  it("403 when edit disabled", async () => {
    editMock.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await POST();
    expect(res.status).toBe(403);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("403 when subscription inactive", async () => {
    subMock.mockRejectedValue(new ForbiddenError("Active subscription required"));
    const res = await POST();
    expect(res.status).toBe(403);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("404 when the client has no firm", async () => {
    clientRow = null;
    const res = await POST();
    expect(res.status).toBe(404);
    expect(setMock).not.toHaveBeenCalled();
  });
});
