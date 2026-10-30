import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceConnectionNotFoundError, WorkspaceImpersonationError } from "@/lib/workspace/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSubscription: vi.fn(),
  resolveActingConnection: vi.fn(),
  deleteConnection: vi.fn(),
  recordAudit: vi.fn(),
  ms: { createEvent: vi.fn(), moveEvent: vi.fn(), cancelEvent: vi.fn(), getEventForEdit: vi.fn(), createTodo: vi.fn(), updateTodo: vi.fn(), revoke: vi.fn() },
  g: { createEvent: vi.fn(), moveEvent: vi.fn(), cancelEvent: vi.fn(), getEventForEdit: vi.fn(), createTodo: vi.fn(), updateTodo: vi.fn(), revoke: vi.fn() },
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/acting-connection", () => ({ resolveActingConnection: mocks.resolveActingConnection }));
vi.mock("@/lib/workspace/connections", () => ({ deleteConnection: mocks.deleteConnection }));
vi.mock("@/lib/workspace/provider-adapter", () => ({
  adapterFor: (p: string) => (p === "google" ? mocks.g : mocks.ms),
}));

const MS = { id: "conn_ms", provider: "microsoft", userId: "user_ada", firmId: "org_1", status: "connected" };
const GOOGLE = { id: "conn_g", provider: "google", userId: "user_ada", firmId: "org_1", status: "connected" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.resolveActingConnection.mockResolvedValue(MS);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.deleteConnection.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

import { POST } from "./route";

const call = (connectionId = "conn_ms") =>
  POST(new Request("https://app.test/x", { method: "POST" }), { params: Promise.resolve({ connectionId }) });

describe("POST /api/workspace/accounts/[connectionId]/disconnect", () => {
  beforeEach(() => {
    mocks.ms.revoke.mockResolvedValue(undefined);
    mocks.g.revoke.mockResolvedValue(undefined);
  });

  it("revokes at the Microsoft provider, then deletes the owner's row, and audits", async () => {
    const order: string[] = [];
    mocks.ms.revoke.mockImplementation(async () => void order.push("revoke"));
    mocks.deleteConnection.mockImplementation(async () => void order.push("delete"));
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(order).toEqual(["revoke", "delete"]);
    expect(mocks.deleteConnection).toHaveBeenCalledWith("org_1", "conn_ms", { userId: "user_ada" });
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: "workspace.disconnect",
      resourceType: "workspace_connection",
      resourceId: "conn_ms",
      firmId: "org_1",
      metadata: { provider: "microsoft", connectionId: "conn_ms" },
    });
  });

  it("a Google connection revokes at Google", async () => {
    mocks.resolveActingConnection.mockResolvedValue(GOOGLE);
    expect((await call("conn_g")).status).toBe(200);
    expect(mocks.g.revoke).toHaveBeenCalledWith(GOOGLE);
    expect(mocks.ms.revoke).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { provider: "google", connectionId: "conn_g" } }),
    );
  });

  it("disconnects a needs_reconnect connection (the gate is told to allow it)", async () => {
    mocks.resolveActingConnection.mockResolvedValue({ ...MS, status: "needs_reconnect" });
    expect((await call()).status).toBe(200);
    expect(mocks.resolveActingConnection).toHaveBeenCalledWith(expect.objectContaining({ allowNeedsReconnect: true }));
    expect(mocks.ms.revoke).toHaveBeenCalledTimes(1);
    expect(mocks.deleteConnection).toHaveBeenCalledWith("org_1", "conn_ms", { userId: "user_ada" });
  });

  it("isn't gated on the subscription", async () => {
    mocks.requireActiveSubscription.mockRejectedValue(new Error("lapsed"));
    expect((await call()).status).toBe(200);
    expect(mocks.requireActiveSubscription).not.toHaveBeenCalled();
  });

  it("is 404 for a connection that isn't the advisor's, and revokes and deletes nothing", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceConnectionNotFoundError());
    expect((await call()).status).toBe(404);
    expect(mocks.ms.revoke).not.toHaveBeenCalled();
    expect(mocks.deleteConnection).not.toHaveBeenCalled();
  });

  it("is 403 impersonating, and nothing is revoked or deleted", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceImpersonationError());
    const res = await call();
    expect(res.status).toBe(403);
    expect(mocks.ms.revoke).not.toHaveBeenCalled();
    expect(mocks.deleteConnection).not.toHaveBeenCalled();
  });
});
