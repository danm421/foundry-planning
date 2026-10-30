import { describe, it, expect, vi } from "vitest";
import type { WorkspaceConnection } from "../connections";
import type { GoogleContext } from "./api";
import { createTodo, listOpenTodos, updateTodo } from "./tasks";

vi.mock("../connections", () => ({
  storeRefreshedTokens: vi.fn(),
  markNeedsReconnect: vi.fn(),
}));

const conn: WorkspaceConnection = {
  id: "conn-1",
  firmId: "firm-1",
  userId: "user-1",
  provider: "google",
  tenantId: "",
  externalUserId: "sub-1",
  externalEmail: "advisor@gmail.test",
  accessToken: "AT",
  refreshToken: "RT",
  tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  scope: "calendar.events tasks",
  status: "connected",
  lastError: null,
  connectedAt: new Date("2026-01-01T00:00:00Z"),
};

function json(body?: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

function setup(...responses: Response[]) {
  const fetchImpl = vi.fn();
  for (const r of responses) fetchImpl.mockResolvedValueOnce(r);
  const ctx: GoogleContext = { conn, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} };
  const call = (i: number) => {
    const [url, init] = fetchImpl.mock.calls[i] as [string, RequestInit];
    return {
      url: new URL(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
  };
  return { ctx, call };
}

describe("listOpenTodos", () => {
  it("reads every list without completed or hidden tasks and maps them", async () => {
    const { ctx, call } = setup(
      json({ items: [{ id: "L1" }, { id: "L2" }] }),
      json({ items: [{ id: "t1", title: "Call Pat", due: "2026-11-02T00:00:00.000Z", notes: "bring file" }] }),
      json({ items: [{ id: "t2", title: "Send form" }] }),
    );
    const todos = await listOpenTodos(ctx);
    expect(call(0).url.pathname).toBe("/tasks/v1/users/@me/lists");
    const urls = [call(1), call(2)].map((c) => c.url);
    expect(urls.map((u) => u.pathname).sort()).toEqual(["/tasks/v1/lists/L1/tasks", "/tasks/v1/lists/L2/tasks"]);
    for (const u of urls) {
      expect(u.searchParams.get("showCompleted")).toBe("false");
      expect(u.searchParams.get("showHidden")).toBe("false");
    }
    expect(todos).toEqual([
      { provider: "google", id: "t1", listId: "L1", title: "Call Pat", dueDate: "2026-11-02", notes: "bring file", notesAreHtml: false },
      { provider: "google", id: "t2", listId: "L2", title: "Send form", dueDate: null, notes: "", notesAreHtml: false },
    ]);
  });
});

describe("createTodo", () => {
  it("posts to the default list with the due date at UTC midnight", async () => {
    const { ctx, call } = setup(json({ id: "t9", title: "File", due: "2026-11-02T00:00:00.000Z" }));
    const todo = await createTodo(ctx, { title: "File", dueDate: "2026-11-02", notes: "n" });
    const c = call(0);
    expect(c.method).toBe("POST");
    expect(c.url.pathname).toBe("/tasks/v1/lists/@default/tasks");
    expect(c.body).toEqual({ title: "File", notes: "n", due: "2026-11-02T00:00:00.000Z" });
    expect(todo).toMatchObject({ id: "t9", listId: "@default", dueDate: "2026-11-02" });
  });

  it("omits due when there is no date", async () => {
    const { ctx, call } = setup(json({ id: "t9", title: "File" }));
    await createTodo(ctx, { title: "File", dueDate: null, notes: "" });
    expect(call(0).body).not.toHaveProperty("due");
  });
});

describe("updateTodo", () => {
  it("completes and reopens by status", async () => {
    const { ctx, call } = setup(json({}), json({}));
    await updateTodo(ctx, { listId: "L1", taskId: "t1", patch: { completed: true } });
    await updateTodo(ctx, { listId: "L1", taskId: "t1", patch: { completed: false } });
    expect(call(0).method).toBe("PATCH");
    expect(call(0).url.pathname).toBe("/tasks/v1/lists/L1/tasks/t1");
    expect(call(0).body).toEqual({ status: "completed" });
    expect(call(1).body).toEqual({ status: "needsAction" });
  });

  it("clears the due date with null and sets one at UTC midnight", async () => {
    const { ctx, call } = setup(json({}), json({}));
    await updateTodo(ctx, { listId: "L1", taskId: "t1", patch: { dueDate: null } });
    await updateTodo(ctx, { listId: "@default", taskId: "t1", patch: { title: "X", dueDate: "2026-12-01", notes: "n" } });
    expect(call(0).body).toEqual({ due: null });
    expect(call(1).url.pathname).toBe("/tasks/v1/lists/@default/tasks/t1");
    expect(call(1).body).toEqual({ title: "X", notes: "n", due: "2026-12-01T00:00:00.000Z" });
  });

  it("encodes provider ids in the path", async () => {
    const { ctx, call } = setup(json({}));
    await updateTodo(ctx, { listId: "a/b", taskId: "c d", patch: { completed: true } });
    expect(call(0).url.pathname).toBe("/tasks/v1/lists/a%2Fb/tasks/c%20d");
  });
});
