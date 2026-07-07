import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  requireAdmin: vi.fn(), orgId: vi.fn(), auth: vi.fn(), user: vi.fn(),
  hasActive: vi.fn(), enqueue: vi.fn(), list: vi.fn(), drain: vi.fn(), after: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => m.auth(),
  currentUser: () => m.user(),
}));
vi.mock("next/server", async (orig) => {
  const actual = await orig<typeof import("next/server")>();
  return { ...actual, after: (cb: () => unknown) => m.after(cb) };
});
vi.mock("@/lib/authz", async (orig) => {
  const actual = await orig<typeof import("@/lib/authz")>();
  return { ...actual, requireOrgAdminOrOwner: () => m.requireAdmin() };
});
vi.mock("@/lib/db-helpers", async (orig) => {
  const actual = await orig<typeof import("@/lib/db-helpers")>();
  return { ...actual, requireOrgId: () => m.orgId() };
});
vi.mock("@/lib/compliance-export/enqueue", () => ({ enqueueFirmComplianceExport: (...a: unknown[]) => m.enqueue(...a) }));
vi.mock("@/lib/compliance-export/batches", () => ({
  hasActiveBatchForFirm: (...a: unknown[]) => m.hasActive(...a),
  listBatchesForFirm: (...a: unknown[]) => m.list(...a),
}));
vi.mock("@/lib/compliance-export/drain", () => ({ drainComplianceExports: (...a: unknown[]) => m.drain(...a) }));

import { POST, GET } from "../route";

beforeEach(() => {
  Object.values(m).forEach((fn) => fn.mockReset());
  m.requireAdmin.mockResolvedValue(undefined);
  m.orgId.mockResolvedValue("f1");
  m.auth.mockResolvedValue({ userId: "user_1" });
  m.user.mockResolvedValue({ emailAddresses: [{ emailAddress: "a@b.co" }] });
});

const req = () => new Request("http://t/api/firm/compliance-exports", { method: "POST" }) as never;

describe("POST /api/firm/compliance-exports", () => {
  it("403 for non-admins", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    m.requireAdmin.mockRejectedValue(new ForbiddenError());
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("409 when a batch is already active", async () => {
    m.hasActive.mockResolvedValue(true);
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect(m.enqueue).not.toHaveBeenCalled();
  });

  it("202 + kicks an immediate drain", async () => {
    m.hasActive.mockResolvedValue(false);
    m.enqueue.mockResolvedValue({ batchId: "b1", total: 3, skipped: 1 });
    const res = await POST(req());
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ batchId: "b1", total: 3, skipped: 1 });
    expect(m.after).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/firm/compliance-exports", () => {
  it("lists the firm's batches", async () => {
    m.list.mockResolvedValue([{ id: "b1" }]);
    const res = await GET(new Request("http://t/api/firm/compliance-exports") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ batches: [{ id: "b1" }] });
  });
});
