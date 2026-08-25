/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from "vitest";
// Section switches all on — they have their own tests (require-portal-feature,
// feature-gate-403, feature-gate-coverage).
vi.mock("@/lib/portal/load-features", () => import("@/lib/portal/__tests__/load-features-mock"));
const { ForbiddenError } = vi.hoisted(() => ({ ForbiddenError: class extends Error {} }));
const resolveMock = vi.fn();
const subMock = vi.fn();
const editMock = vi.fn();
const authErrMock = vi.fn();
const recordUpdateMock = vi.fn();
const areaSharedMock = vi.fn();
const pageMock = vi.fn();
const countMock = vi.fn();
let clientRow: any;
let updatedRows: Array<{ id: string }>;
const setMock = vi.fn();
const whereMock = vi.fn();

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
// The queue query itself is one shared module (to-review-queue), covered by
// its own test — here it stands in so the route's own logic is what is asserted.
vi.mock("@/lib/portal/to-review-queue", () => ({
  REVIEW_PAGE_SIZE: 5,
  toReviewWhere: (clientId: string) => ["queue-where", clientId],
  toReviewPage: (...a: unknown[]) => pageMock(...a),
  toReviewCount: (...a: unknown[]) => countMock(...a),
}));
vi.mock("@/db/schema", () => ({
  plaidTransactions: { _name: "plaid_transactions", id: "id" },
  clients: { _name: "clients" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  inArray: (...a: unknown[]) => ["inArray", ...a],
}));
vi.mock("@/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve(clientRow ? [clientRow] : []) }) }) }),
    update: () => ({
      set: (v: unknown) => {
        setMock(v);
        return { where: (w: unknown) => { whereMock(w); return { returning: () => Promise.resolve(updatedRows) }; } };
      },
    }),
  },
}));
import { GET, POST } from "@/app/api/portal/transactions/review-queue/route";

const NEXT_PAGE = [{ id: "t6", date: "2026-06-01", name: "SBUX", merchantName: null, amount: 6, accountName: "Card", categoryId: null, categoryName: null, categoryColor: null }];

function post(body: unknown): Request {
  return new Request("http://x/api/portal/transactions/review-queue", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  resolveMock.mockReset(); subMock.mockReset(); editMock.mockReset(); authErrMock.mockReset();
  recordUpdateMock.mockReset(); areaSharedMock.mockReset(); setMock.mockReset(); whereMock.mockReset();
  pageMock.mockReset(); countMock.mockReset();
  areaSharedMock.mockResolvedValue(undefined);
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  subMock.mockResolvedValue(undefined); editMock.mockResolvedValue(undefined);
  clientRow = { firmId: "firm-1" };
  updatedRows = [{ id: "t1" }, { id: "t2" }, { id: "t3" }];
  pageMock.mockResolvedValue(NEXT_PAGE);
  countMock.mockResolvedValue(12);
  authErrMock.mockImplementation((e: unknown) =>
    e instanceof ForbiddenError ? { status: 403, body: { error: (e as Error).message } } : null,
  );
});

describe("POST /api/portal/transactions/review-queue", () => {
  it("marks only the ids sent and hands back the next page + remaining count", async () => {
    const res = await POST(post({ ids: ["t1", "t2", "t3"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, marked: 3, items: NEXT_PAGE, count: 12 });
    const patch = setMock.mock.calls[0][0];
    expect(patch.reviewedAt).toBeInstanceOf(Date);
    expect(patch.reviewedBy).toBe("u1");
    // The queue filter is ANDed with the id list, so an id outside this
    // client's queue can never be stamped.
    expect(JSON.stringify(whereMock.mock.calls[0][0])).toContain("queue-where");
    expect(JSON.stringify(whereMock.mock.calls[0][0])).toContain("inArray");
    expect(recordUpdateMock.mock.calls[0][0]).toMatchObject({
      action: "portal.transaction.review_batch",
      actorKind: "client",
      firmId: "firm-1",
      clientId: "c1",
      extraMetadata: { count: 3 },
    });
  });

  it("400s on an empty or missing id list without touching the table", async () => {
    expect((await POST(post({ ids: [] }))).status).toBe(400);
    expect((await POST(post({}))).status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("400s past the id cap", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `t${i}`);
    expect((await POST(post({ ids }))).status).toBe(400);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("does not audit when the ids were already reviewed", async () => {
    updatedRows = [];
    const res = await POST(post({ ids: ["t1"] }));
    expect(res.status).toBe(200);
    expect((await res.json()).marked).toBe(0);
    expect(recordUpdateMock).not.toHaveBeenCalled();
  });

  it("advisor act-as preview audits as advisor with viaPreview", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "advisor-1" });
    await POST(post({ ids: ["t1"] }));
    expect(recordUpdateMock.mock.calls[0][0]).toMatchObject({
      actorKind: "advisor",
      extraMetadata: { count: 3, viaPreview: true },
    });
  });

  it("403 when edit disabled", async () => {
    editMock.mockRejectedValue(new ForbiddenError("Portal editing disabled by advisor"));
    const res = await POST(post({ ids: ["t1"] }));
    expect(res.status).toBe(403);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("403 when subscription inactive", async () => {
    subMock.mockRejectedValue(new ForbiddenError("Active subscription required"));
    const res = await POST(post({ ids: ["t1"] }));
    expect(res.status).toBe(403);
    expect(setMock).not.toHaveBeenCalled();
  });

  it("404 when the client has no firm", async () => {
    clientRow = null;
    const res = await POST(post({ ids: ["t1"] }));
    expect(res.status).toBe(404);
    expect(setMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/portal/transactions/review-queue", () => {
  it("returns the current page and the total still unreviewed", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: NEXT_PAGE, count: 12 });
    expect(pageMock).toHaveBeenCalledWith("c1");
  });

  it("403 when transactions are not shared", async () => {
    areaSharedMock.mockRejectedValue(new ForbiddenError("Not shared"));
    expect((await GET()).status).toBe(403);
  });

  // Reading the queue is not an edit — a read-only portal still refills.
  it("does not require editing to be enabled", async () => {
    await GET();
    expect(editMock).not.toHaveBeenCalled();
  });
});
