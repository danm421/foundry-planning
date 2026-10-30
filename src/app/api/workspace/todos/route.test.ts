import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceImpersonationError } from "@/lib/workspace/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  listActingConnections: vi.fn(),
  readTodos: vi.fn(),
  listTasks: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/crm-tasks/queries", () => ({ listTasks: mocks.listTasks }));
vi.mock("@/lib/workspace/acting-connection", () => ({ listActingConnections: mocks.listActingConnections }));
vi.mock("@/lib/workspace/readers", () => ({ readTodos: mocks.readTodos }));

import { GET } from "./route";

const MS = { id: "conn_ms", provider: "microsoft", status: "connected" };
const GOOGLE = { id: "conn_g", provider: "google", status: "needs_reconnect" };
const FOUNDRY = [{ id: "t1", title: "Call Smith" }];
const MS_TODO = { provider: "microsoft", id: "o1", listId: "l1", title: "Pay", dueDate: null, notes: "", notesAreHtml: false };
const ACCOUNTS = [
  { connectionId: "conn_ms", provider: "microsoft", todos: [MS_TODO], error: null },
  { connectionId: "conn_g", provider: "google", todos: null, error: "needs_reconnect" },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.listActingConnections.mockResolvedValue([MS, GOOGLE]);
  mocks.listTasks.mockResolvedValue(FOUNDRY);
  mocks.readTodos.mockResolvedValue(ACCOUNTS);
  mocks.recordAudit.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/workspace/todos", () => {
  it("returns the caller's open Foundry tasks plus every account's to-dos or error", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ foundry: FOUNDRY, accounts: ACCOUNTS, blocked: null });

    expect(mocks.listActingConnections).toHaveBeenCalledWith({ firmId: "org_1", actorUserId: "user_ada" });
    expect(mocks.readTodos).toHaveBeenCalledWith({ connections: [MS, GOOGLE] });
    const [firmId, viewer, scope, filters] = mocks.listTasks.mock.calls[0];
    expect(firmId).toBe("org_1");
    expect(viewer).toEqual({ userId: "user_ada", orgRole: "org:member" });
    expect(scope).toEqual({});
    expect(filters.assigneeUserId).toBe("user_ada");
    expect(filters.status).toEqual(["open", "in_progress", "blocked"]);
  });

  it("no connected accounts → Foundry tasks alone, no accounts", async () => {
    mocks.listActingConnections.mockResolvedValue([]);
    mocks.readTodos.mockResolvedValue([]);
    expect(await (await GET()).json()).toEqual({ foundry: FOUNDRY, accounts: [], blocked: null });
  });

  it("(Review Focus 5) an impersonation session still lists Foundry tasks, reads no account, and says why", async () => {
    mocks.listActingConnections.mockRejectedValue(new WorkspaceImpersonationError());
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ foundry: FOUNDRY, accounts: [], blocked: "impersonating" });
    expect(mocks.readTodos).not.toHaveBeenCalled();
  });

  it("a connection that can't be read (e.g. a token that won't decrypt) never hides Foundry tasks, and logs its name only", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listActingConnections.mockRejectedValue(new Error("Unsupported state: secret detail"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ foundry: FOUNDRY, accounts: [], blocked: null });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(spy.mock.calls)).toContain("Error");
    expect(JSON.stringify(spy.mock.calls)).not.toContain("secret detail");
    expect(mocks.readTodos).not.toHaveBeenCalled();
  });

  it("is 500 when the Foundry side fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.listTasks.mockRejectedValue(new Error("db down"));
    expect((await GET()).status).toBe(500);
  });

  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await GET()).status).toBe(404);
  });
});
