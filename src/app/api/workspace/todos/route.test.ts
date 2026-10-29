import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import {
  ProviderRequestError,
  ProviderThrottledError,
  WorkspaceNotConnectedError,
  WorkspaceReconnectRequiredError,
} from "@/lib/workspace/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSubscription: vi.fn(),
  resolveActingConnection: vi.fn(),
  listOpenTodos: vi.fn(),
  createTodo: vi.fn(),
  listTasks: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/crm-tasks/queries", () => ({ listTasks: mocks.listTasks }));
vi.mock("@/lib/workspace/acting-connection", () => ({ resolveActingConnection: mocks.resolveActingConnection }));
vi.mock("@/lib/workspace/microsoft/todo", () => ({
  listOpenTodos: mocks.listOpenTodos,
  createTodo: mocks.createTodo,
}));

import { GET, POST } from "./route";

const CONN = { id: "conn_1" };
const FOUNDRY = [{ id: "t1", title: "Call Smith" }];
const OUTLOOK = [{ provider: "microsoft", id: "o1", listId: "l1", title: "Pay", dueDate: null, notes: "" }];

const post = (b: unknown) =>
  POST(
    new Request("https://app.test/api/workspace/todos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.resolveActingConnection.mockResolvedValue(CONN);
  mocks.listTasks.mockResolvedValue(FOUNDRY);
  mocks.listOpenTodos.mockResolvedValue(OUTLOOK);
  mocks.recordAudit.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/workspace/todos", () => {
  it("returns both sides, listing only the caller's open Foundry tasks", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ foundry: FOUNDRY, outlook: OUTLOOK, outlookError: null });
    const [firmId, viewer, scope, filters] = mocks.listTasks.mock.calls[0];
    expect(firmId).toBe("org_1");
    expect(viewer).toEqual({ userId: "user_ada", orgRole: "org:member" });
    expect(scope).toEqual({});
    expect(filters.assigneeUserId).toBe("user_ada");
    expect(filters.status).toEqual(["open", "in_progress", "blocked"]);
  });

  it.each([
    ["not connected", new WorkspaceNotConnectedError("member_off"), "not_connected"],
    ["reconnect", new WorkspaceReconnectRequiredError(), "needs_reconnect"],
    ["throttled", new ProviderThrottledError("microsoft", "rid"), "throttled"],
    // (R24) Only throttling reads "busy"; any other Microsoft failure can't-load.
    ["other Graph error", new ProviderRequestError("microsoft", 500, "boom", "rid"), "unavailable"],
    ["mailbox Graph can't serve", new ProviderRequestError("microsoft", 404, "MailboxNotEnabledForRESTAPI", "rid"), "unavailable"],
    ["unknown error", new Error("secret detail"), "unavailable"],
  ])("keeps Foundry tasks and sets outlookError when Microsoft fails (%s)", async (_n, err, outlookError) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.resolveActingConnection.mockRejectedValue(err);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ foundry: FOUNDRY, outlook: null, outlookError });
  });

  it("degrades when listOpenTodos itself throws, logging only the name", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listOpenTodos.mockRejectedValue(new Error("secret detail"));
    const res = await GET();
    expect((await res.json()).outlookError).toBe("unavailable");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret detail");
  });

  it("is 500 only when the Foundry side fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listTasks.mockRejectedValue(new Error("db down"));
    expect((await GET()).status).toBe(500);
  });

  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await GET()).status).toBe(404);
  });
});

describe("POST /api/workspace/todos", () => {
  it("creates a todo and audits ids only", async () => {
    mocks.createTodo.mockResolvedValue({ provider: "microsoft", id: "o9", listId: "l1" });
    const res = await post({ title: "Call", dueDate: "2026-11-05" });
    expect(res.status).toBe(201);
    expect(mocks.createTodo).toHaveBeenCalledWith({ conn: CONN }, { title: "Call", dueDate: "2026-11-05", notes: "" });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.todo_create", resourceId: "o9", metadata: { listId: "l1", taskId: "o9" } }),
    );
  });

  it("is 403 and never calls Graph when the subscription lapsed", async () => {
    mocks.requireActiveSubscription.mockRejectedValue(new ForbiddenError("Active subscription required"));
    expect((await post({ title: "Call" })).status).toBe(403);
    expect(mocks.createTodo).not.toHaveBeenCalled();
  });

  it("is 400 for an empty title", async () => {
    expect((await post({ title: "" })).status).toBe(400);
  });
});
