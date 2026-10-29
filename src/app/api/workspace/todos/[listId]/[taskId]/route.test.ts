import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSubscription: vi.fn(),
  resolveActingConnection: vi.fn(),
  updateTodo: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/acting-connection", () => ({ resolveActingConnection: mocks.resolveActingConnection }));
vi.mock("@/lib/workspace/microsoft/todo", () => ({ updateTodo: mocks.updateTodo }));

import { PATCH } from "./route";

const CONN = { id: "conn_1" };
const patch = (b: unknown) =>
  PATCH(
    new Request("https://app.test/api/workspace/todos/l1/t1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    }),
    { params: Promise.resolve({ listId: "l1", taskId: "t1" }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.resolveActingConnection.mockResolvedValue(CONN);
  mocks.updateTodo.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("PATCH /api/workspace/todos/[listId]/[taskId]", () => {
  it("completes a task and audits", async () => {
    const res = await patch({ completed: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.updateTodo).toHaveBeenCalledWith({ conn: CONN }, { listId: "l1", taskId: "t1", patch: { completed: true } });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.todo_update", resourceId: "t1", metadata: { listId: "l1", taskId: "t1", completed: true } }),
    );
  });

  it("is 400 for an empty patch", async () => {
    expect((await patch({})).status).toBe(400);
    expect(mocks.updateTodo).not.toHaveBeenCalled();
  });

  it("is 403 when the subscription lapsed", async () => {
    mocks.requireActiveSubscription.mockRejectedValue(new ForbiddenError("Active subscription required"));
    expect((await patch({ completed: true })).status).toBe(403);
    expect(mocks.updateTodo).not.toHaveBeenCalled();
  });
});
