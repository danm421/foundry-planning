// src/app/api/portal/settings/__tests__/route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveMock = vi.fn();
vi.mock("@/lib/portal/resolve-portal-client", () => ({
  resolvePortalClient: () => resolveMock(),
}));
const authErrMock = vi.fn((_e: unknown) => null);
vi.mock("@/lib/authz", () => ({ authErrorResponse: (e: unknown) => authErrMock(e) }));
const subMock = vi.fn();
vi.mock("@/lib/portal/require-portal-subscription", () => ({
  requirePortalActiveSubscription: (id: string) => subMock(id),
}));
const loadPrivacyMock = vi.fn();
vi.mock("@/lib/portal/privacy", () => ({
  loadPortalPrivacy: (id: string) => loadPrivacyMock(id),
}));
const recordUpdateMock = vi.fn();
vi.mock("@/lib/audit/record-helpers", () => ({
  recordUpdate: (a: unknown) => recordUpdateMock(a),
}));
vi.mock("@/db/schema", () => ({
  portalPrivacySettings: { _name: "portal_privacy_settings", clientId: "client_id" },
  clients: { _name: "clients" },
}));
vi.mock("drizzle-orm", () => ({ eq: (...a: unknown[]) => a }));

const selectQueue: unknown[][] = [];
const insertValuesMock = vi.fn();
const onConflictMock = vi.fn();
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
  },
}));

import { GET, PUT } from "@/app/api/portal/settings/route";

const ALL_ON = { shareTransactions: true, shareBudgets: true, shareRecurrings: true };

function putReq(body: unknown): Request {
  return new Request("http://t/api/portal/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  selectQueue.length = 0;
  insertValuesMock.mockClear();
  onConflictMock.mockClear();
  recordUpdateMock.mockClear();
  resolveMock.mockReset();
  resolveMock.mockResolvedValue({ clientId: "c1", mode: "client", clerkUserId: "u1" });
  subMock.mockReset();
  subMock.mockResolvedValue(undefined);
  loadPrivacyMock.mockReset();
  loadPrivacyMock.mockResolvedValue({ ...ALL_ON });
});

describe("GET /api/portal/settings", () => {
  it("returns the privacy flags and actor mode", async () => {
    loadPrivacyMock.mockResolvedValue({ ...ALL_ON, shareBudgets: false });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.privacy).toEqual({ ...ALL_ON, shareBudgets: false });
    expect(body.mode).toBe("client");
  });
  it("works for the advisor preview (read-only display)", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "adv" });
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).mode).toBe("advisor");
  });
});

describe("PUT /api/portal/settings", () => {
  it("upserts changed flags and audits as the client", async () => {
    selectQueue.push([{ firmId: "firm-1" }]);
    const res = await PUT(putReq({ shareTransactions: false }));
    expect(res.status).toBe(200);
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: "c1", shareTransactions: false, shareBudgets: true }),
    );
    expect(onConflictMock).toHaveBeenCalled();
    expect(recordUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "portal.privacy.update",
        actorKind: "client",
        after: expect.objectContaining({ shareTransactions: false }),
      }),
    );
    expect((await res.json()).privacy.shareTransactions).toBe(false);
  });
  it("rejects the advisor act-as preview (403) without writing", async () => {
    resolveMock.mockResolvedValue({ clientId: "c1", mode: "advisor", clerkUserId: "adv" });
    const res = await PUT(putReq({ shareTransactions: false }));
    expect(res.status).toBe(403);
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(recordUpdateMock).not.toHaveBeenCalled();
  });
  it("400s on a non-boolean flag", async () => {
    const res = await PUT(putReq({ shareBudgets: "nope" }));
    expect(res.status).toBe(400);
    expect(insertValuesMock).not.toHaveBeenCalled();
  });
  it("400s when no known flag is present", async () => {
    const res = await PUT(putReq({ unrelated: true }));
    expect(res.status).toBe(400);
  });
});
