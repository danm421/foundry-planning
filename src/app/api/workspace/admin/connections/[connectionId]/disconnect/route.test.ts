import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSubscription: vi.fn(),
  getConnectionById: vi.fn(),
  deleteConnection: vi.fn(),
  recordAudit: vi.fn(),
  ms: { revoke: vi.fn() },
  g: { revoke: vi.fn() },
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/connections", () => ({
  getConnectionById: mocks.getConnectionById,
  deleteConnection: mocks.deleteConnection,
}));
vi.mock("@/lib/workspace/provider-adapter", () => ({
  adapterFor: (p: string) => (p === "google" ? mocks.g : mocks.ms),
}));

import { POST } from "./route";

const G_ID = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
const MS_ID = "0b9e8d7c-6a5f-4e3d-8c2b-1a0f9e8d7c6b";
/** An advisor's Google address in the admin's firm. */
const GOOGLE = { id: G_ID, provider: "google", userId: "user_ada", firmId: "org_1", status: "connected" };
const MS = { id: MS_ID, provider: "microsoft", userId: "user_ada", firmId: "org_1", status: "needs_reconnect" };

const ADMIN = { userId: "user_admin", orgId: "org_1", orgRole: "org:admin" };

const call = (connectionId = G_ID) =>
  POST(new Request("https://app.test/x", { method: "POST" }), { params: Promise.resolve({ connectionId }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue(ADMIN);
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.getConnectionById.mockResolvedValue(GOOGLE);
  mocks.deleteConnection.mockResolvedValue(true);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.ms.revoke.mockResolvedValue(undefined);
  mocks.g.revoke.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

function nothingTouched() {
  expect(mocks.g.revoke).not.toHaveBeenCalled();
  expect(mocks.ms.revoke).not.toHaveBeenCalled();
  expect(mocks.deleteConnection).not.toHaveBeenCalled();
  expect(mocks.recordAudit).not.toHaveBeenCalled();
}

describe("POST /api/workspace/admin/connections/[connectionId]/disconnect", () => {
  it("is 404 when Workspace is off, before any read", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await call()).status).toBe(404);
    expect(mocks.getConnectionById).not.toHaveBeenCalled();
    nothingTouched();
  });

  it("refuses a non-admin with 403 and reads nothing", async () => {
    mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
    expect((await call()).status).toBe(403);
    expect(mocks.getConnectionById).not.toHaveBeenCalled();
    nothingTouched();
  });

  it("is 403 impersonating, even as an admin, and reads nothing", async () => {
    mocks.auth.mockResolvedValue({ ...ADMIN, actor: { sub: "user_ops" } });
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "impersonating" });
    expect(mocks.getConnectionById).not.toHaveBeenCalled();
    nothingTouched();
  });

  it("is 404 for an id that isn't a uuid, without querying", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
    expect(mocks.getConnectionById).not.toHaveBeenCalled();
    nothingTouched();
  });

  it("is 404 for another firm's connection, and revokes and deletes nothing", async () => {
    mocks.getConnectionById.mockResolvedValue({ ...GOOGLE, firmId: "org_other" });
    expect((await call()).status).toBe(404);
    nothingTouched();
  });

  it("is 404 for a connection that doesn't exist", async () => {
    mocks.getConnectionById.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    nothingTouched();
  });

  it("revokes at the provider, then deletes the row with no owner restriction, and audits the provider", async () => {
    const order: string[] = [];
    mocks.g.revoke.mockImplementation(async () => void order.push("revoke"));
    mocks.deleteConnection.mockImplementation(async () => {
      order.push("delete");
      return true;
    });

    const res = await call();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.getConnectionById).toHaveBeenCalledWith(G_ID);
    expect(mocks.g.revoke).toHaveBeenCalledWith(GOOGLE);
    expect(mocks.ms.revoke).not.toHaveBeenCalled();
    expect(order).toEqual(["revoke", "delete"]);
    // An advisor's row, removed by their admin: no owner filter (never `userId: ""`).
    expect(mocks.deleteConnection).toHaveBeenCalledWith("org_1", G_ID);
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: "workspace.admin_disconnect",
      resourceType: "workspace_connection",
      resourceId: G_ID,
      firmId: "org_1",
      metadata: { provider: "google", connectionId: G_ID, userId: "user_ada" },
    });
  });

  it("disconnects a Microsoft address that needs to reconnect", async () => {
    mocks.getConnectionById.mockResolvedValue(MS);
    expect((await call(MS_ID)).status).toBe(200);
    expect(mocks.ms.revoke).toHaveBeenCalledWith(MS);
    expect(mocks.deleteConnection).toHaveBeenCalledWith("org_1", MS_ID);
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { provider: "microsoft", connectionId: MS_ID, userId: "user_ada" } }),
    );
  });

  it("isn't gated on the subscription", async () => {
    mocks.requireActiveSubscription.mockRejectedValue(new Error("lapsed"));
    expect((await call()).status).toBe(200);
    expect(mocks.requireActiveSubscription).not.toHaveBeenCalled();
  });
});
