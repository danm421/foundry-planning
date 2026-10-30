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

const json = (b: unknown, method: string) =>
  new Request("https://app.test/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

import { PATCH } from "./route";

const call = (b: unknown = { completed: true }, connectionId = "conn_ms") =>
  PATCH(json(b, "PATCH"), { params: Promise.resolve({ connectionId, listId: "l/1=", taskId: "t/1=" }) });

describe("PATCH /api/workspace/accounts/[connectionId]/todos/[listId]/[taskId]", () => {
  beforeEach(() => {
    mocks.ms.updateTodo.mockResolvedValue(undefined);
    mocks.g.updateTodo.mockResolvedValue(undefined);
  });

  it("updates through the Microsoft adapter and audits provider and connection", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.ms.updateTodo).toHaveBeenCalledWith(MS, { listId: "l/1=", taskId: "t/1=", patch: { completed: true } });
    expect(mocks.g.updateTodo).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.todo_update",
        metadata: { provider: "microsoft", connectionId: "conn_ms", listId: "l/1=", taskId: "t/1=", completed: true },
      }),
    );
  });

  it("a Google connection updates through the Google adapter", async () => {
    mocks.resolveActingConnection.mockResolvedValue(GOOGLE);
    expect((await call(undefined, "conn_g")).status).toBe(200);
    // (M8) The path's connection id is the one the gate checks.
    expect(mocks.resolveActingConnection).toHaveBeenCalledWith({ firmId: "org_1", actorUserId: "user_ada", connectionId: "conn_g" });
    expect(mocks.g.updateTodo).toHaveBeenCalledTimes(1);
    expect(mocks.ms.updateTodo).not.toHaveBeenCalled();
  });

  it("is 400 for an empty patch", async () => {
    expect((await call({})).status).toBe(400);
    expect(mocks.ms.updateTodo).not.toHaveBeenCalled();
  });

  it("is 404 for a connection that isn't the advisor's", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceConnectionNotFoundError());
    expect((await call()).status).toBe(404);
  });

  it("is 403 impersonating", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceImpersonationError());
    expect((await call()).status).toBe(403);
    expect(mocks.ms.updateTodo).not.toHaveBeenCalled();
  });
});
