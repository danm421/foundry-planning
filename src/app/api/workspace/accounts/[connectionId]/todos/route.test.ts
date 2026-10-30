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

import { POST } from "./route";

const call = (b: unknown = { title: "Call Schwab", dueDate: "2026-11-14" }, connectionId = "conn_ms") =>
  POST(json(b, "POST"), { params: Promise.resolve({ connectionId }) });

describe("POST /api/workspace/accounts/[connectionId]/todos", () => {
  beforeEach(() => {
    mocks.ms.createTodo.mockResolvedValue({ id: "t1", listId: "l1" });
    mocks.g.createTodo.mockResolvedValue({ id: "t2", listId: "l2" });
  });

  it("creates through the Microsoft adapter and audits provider and connection", async () => {
    const res = await call();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ todo: { id: "t1", listId: "l1" } });
    expect(mocks.ms.createTodo).toHaveBeenCalledWith(MS, { title: "Call Schwab", dueDate: "2026-11-14", notes: "" });
    expect(mocks.g.createTodo).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.todo_create", metadata: { provider: "microsoft", connectionId: "conn_ms", listId: "l1", taskId: "t1" } }),
    );
  });

  it("a Google connection creates through the Google adapter", async () => {
    mocks.resolveActingConnection.mockResolvedValue(GOOGLE);
    expect((await call(undefined, "conn_g")).status).toBe(201);
    expect(mocks.g.createTodo).toHaveBeenCalledTimes(1);
    expect(mocks.ms.createTodo).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ provider: "google", connectionId: "conn_g" }) }),
    );
  });

  it("is 400 for an empty title", async () => {
    expect((await call({ title: " " })).status).toBe(400);
    expect(mocks.ms.createTodo).not.toHaveBeenCalled();
  });

  it("is 404 for a connection that isn't the advisor's", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceConnectionNotFoundError());
    expect((await call()).status).toBe(404);
  });

  it("is 403 impersonating", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceImpersonationError());
    expect((await call()).status).toBe(403);
    expect(mocks.ms.createTodo).not.toHaveBeenCalled();
  });
});
