// src/lib/workspace/microsoft/todo.test.ts
import { describe, it, expect, vi } from "vitest";
import type { WorkspaceConnection } from "../connections";
import type { GraphContext } from "./graph";
import { createTodo, listOpenTodos, updateTodo } from "./todo";

vi.mock("../connections", () => ({
  storeRefreshedTokens: vi.fn(),
  markNeedsReconnect: vi.fn(),
}));

const conn: WorkspaceConnection = {
  id: "conn-1",
  firmId: "firm-1",
  userId: "user-1",
  provider: "microsoft",
  tenantId: "tenant-1",
  externalUserId: "oid-1",
  externalEmail: "advisor@firm.test",
  accessToken: "AT",
  refreshToken: "RT",
  tokenExpiresAt: new Date("2099-01-01T00:00:00Z"),
  scope: "Tasks.ReadWrite",
  status: "connected",
  lastError: null,
  connectedAt: new Date("2026-01-01T00:00:00Z"),
};

function json(body?: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status });
}

/** Routes by URL so parallel per-list calls don't depend on call order. */
function setupRouted(routes: (url: string, init: RequestInit) => Response) {
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => routes(url, init));
  const ctx: GraphContext = { conn, fetchImpl: fetchImpl as unknown as typeof fetch };
  const calls = () =>
    fetchImpl.mock.calls.map(([url, init]) => ({
      url: decodeURIComponent(url),
      method: init.method ?? "GET",
      body: init.body ? JSON.parse(init.body as string) : undefined,
    }));
  return { ctx, calls };
}

const task = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Task ${id}`,
  status: "notStarted",
  body: { content: "", contentType: "text" },
  ...extra,
});

describe("listOpenTodos", () => {
  const lists = {
    value: [
      { id: "L1", wellknownListName: "defaultList" },
      { id: "L2", wellknownListName: "none" },
      { id: "LF", wellknownListName: "flaggedEmails" },
    ],
  };

  it("merges open tasks from every list except flagged emails, filtering out completed", async () => {
    const { ctx, calls } = setupRouted((url) => {
      if (url.endsWith("/me/todo/lists")) return json(lists);
      if (url.includes("/lists/L1/tasks")) return json({ value: [task("a")] });
      if (url.includes("/lists/L2/tasks")) return json({ value: [task("b")] });
      throw new Error(`unexpected ${url}`);
    });
    const todos = await listOpenTodos(ctx);

    expect(todos.map((t) => [t.id, t.listId])).toEqual([
      ["a", "L1"],
      ["b", "L2"],
    ]);
    expect(todos[0].provider).toBe("microsoft");
    expect(calls().some((c) => c.url.includes("LF"))).toBe(false);
    const taskCall = calls().find((c) => c.url.includes("/lists/L1/tasks"))!;
    const params = new URL(taskCall.url).searchParams;
    expect(params.get("$filter")).toBe("status ne 'completed'");
    expect(params.get("$top")).toBe("100");
  });

  it("maps due date and text notes, and follows nextLink", async () => {
    const { ctx } = setupRouted((url) => {
      if (url.endsWith("/me/todo/lists")) return json({ value: [{ id: "L1", wellknownListName: "none" }] });
      if (url.includes("skip=1")) return json({ value: [task("b")] });
      return json({
        value: [
          task("a", {
            dueDateTime: { dateTime: "2026-10-30T00:00:00.0000000", timeZone: "UTC" },
            body: { content: "call back", contentType: "text" },
          }),
          task("h", { body: { content: "<p>x</p>", contentType: "html" } }),
        ],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/todo/lists/L1/tasks?skip=1",
      });
    });
    const todos = await listOpenTodos(ctx);

    expect(todos.map((t) => t.id)).toEqual(["a", "h", "b"]);
    expect(todos[0]).toMatchObject({ dueDate: "2026-10-30", notes: "call back", notesAreHtml: false, title: "Task a" });
    expect(todos[1]).toMatchObject({ dueDate: null, notes: "" });
  });

  it("(I1) flags formatted notes so they are never shown blank and overwritten", async () => {
    const { ctx } = setupRouted((url) => {
      if (url.endsWith("/me/todo/lists")) return json({ value: [{ id: "L1", wellknownListName: "none" }] });
      return json({
        value: [
          task("html", { body: { content: "<p>Call <b>Ada</b></p>", contentType: "html" } }),
          task("empty-html", { body: { content: "", contentType: "html" } }),
          task("text", { body: { content: "plain", contentType: "text" } }),
        ],
      });
    });
    const byId = Object.fromEntries((await listOpenTodos(ctx)).map((t) => [t.id, t]));

    expect(byId.html).toMatchObject({ notes: "", notesAreHtml: true });
    // An empty HTML body holds nothing to lose: it edits like a plain one.
    expect(byId["empty-html"]).toMatchObject({ notes: "", notesAreHtml: false });
    expect(byId.text).toMatchObject({ notes: "plain", notesAreHtml: false });
  });

  it.each([
    // To Do answers in UTC: the mailbox's midnight, shifted by its offset.
    ["US Eastern midnight, in UTC", { dateTime: "2026-10-30T04:00:00.0000000", timeZone: "UTC" }],
    ["Central European midnight, in UTC", { dateTime: "2026-10-29T23:00:00.0000000", timeZone: "UTC" }],
    ["Tokyo midnight, in UTC", { dateTime: "2026-10-29T15:00:00.0000000", timeZone: "UTC" }],
    ["Hawaii midnight, in UTC", { dateTime: "2026-10-30T10:00:00.0000000", timeZone: "UTC" }],
    ["a date already in the mailbox's zone", { dateTime: "2026-10-30T00:00:00.0000000", timeZone: "Eastern Standard Time" }],
  ])("(I7) reads the mailbox's day from %s", async (_label, dueDateTime) => {
    const { ctx } = setupRouted((url) => {
      if (url.endsWith("/me/todo/lists")) return json({ value: [{ id: "L1", wellknownListName: "none" }] });
      return json({ value: [task("a", { dueDateTime })] });
    });
    expect((await listOpenTodos(ctx))[0].dueDate).toBe("2026-10-30");
  });

  it("(I4) reads at most 4 lists at a time, keeping list order", async () => {
    const ids = Array.from({ length: 10 }, (_, i) => `L${i}`);
    let inFlight = 0;
    let most = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/me/todo/lists")) return json({ value: ids.map((id) => ({ id, wellknownListName: "none" })) });
      inFlight++;
      most = Math.max(most, inFlight);
      // Later lists answer sooner, so order can't come from timing.
      const id = /lists\/(L\d+)\/tasks/.exec(url)![1];
      await new Promise((r) => setTimeout(r, 20 - Number(id.slice(1))));
      inFlight--;
      return json({ value: [task(`t-${id}`)] });
    });
    const todos = await listOpenTodos({ conn, fetchImpl: fetchImpl as unknown as typeof fetch });

    expect(most).toBe(4);
    expect(todos.map((t) => t.listId)).toEqual(ids);
  });

  it("(I4) a failing list read still fails the whole read, as before", async () => {
    const { ctx } = setupRouted((url) => {
      if (url.endsWith("/me/todo/lists")) return json({ value: [{ id: "L1" }, { id: "L2" }, { id: "L3" }] });
      if (url.includes("/lists/L2/")) return json({ error: { code: "ErrorAccessDenied" } }, 403);
      return json({ value: [task("x")] });
    });
    await expect(listOpenTodos(ctx)).rejects.toMatchObject({ name: "ProviderRequestError", status: 403 });
  });
});

/** The mailbox's own time zone, as `/me/mailboxSettings/timeZone` answers. */
const MAILBOX_TZ = "Eastern Standard Time";
const isMailboxZone = (url: string) => url.endsWith("/me/mailboxSettings/timeZone");

describe("createTodo", () => {
  it("posts into the default list, due at midnight in the mailbox's zone, and maps the result", async () => {
    const { ctx, calls } = setupRouted((url, init) => {
      if (url.endsWith("/me/todo/lists")) {
        return json({ value: [{ id: "L2", wellknownListName: "none" }, { id: "L1", wellknownListName: "defaultList" }] });
      }
      if (isMailboxZone(url)) return json({ value: MAILBOX_TZ });
      if (init.method === "POST") return json(task("new", { title: "Call" }), 201);
      throw new Error(`unexpected ${url}`);
    });
    const todo = await createTodo(ctx, { title: "Call", dueDate: "2026-10-30", notes: "n" });

    const post = calls().find((c) => c.method === "POST")!;
    expect(post.url).toBe("https://graph.microsoft.com/v1.0/me/todo/lists/L1/tasks");
    expect(post.body).toEqual({
      title: "Call",
      dueDateTime: { dateTime: "2026-10-30T00:00:00", timeZone: MAILBOX_TZ },
      body: { content: "n", contentType: "text" },
    });
    expect(todo).toMatchObject({ id: "new", listId: "L1", title: "Call" });
  });

  it("with no due date, never reads the mailbox's zone", async () => {
    const { ctx, calls } = setupRouted((url, init) => {
      if (url.endsWith("/me/todo/lists")) return json({ value: [{ id: "L1", wellknownListName: "defaultList" }] });
      if (init.method === "POST") return json(task("new"), 201);
      throw new Error(`unexpected ${url}`);
    });
    await createTodo(ctx, { title: "Call", dueDate: null, notes: "" });
    expect(calls().find((c) => c.method === "POST")!.body).not.toHaveProperty("dueDateTime");
  });

  it("throws when there is no default list", async () => {
    const { ctx } = setupRouted(() => json({ value: [{ id: "L2", wellknownListName: "none" }] }));
    await expect(createTodo(ctx, { title: "x", dueDate: null, notes: "" })).rejects.toThrow(/default/i);
  });
});

describe("updateTodo", () => {
  /** The PATCH it sent; the mailbox's zone is read only for a new due date. */
  function patchOf(patch: Parameters<typeof updateTodo>[1]["patch"]) {
    const { ctx, calls } = setupRouted((url) => (isMailboxZone(url) ? json({ value: MAILBOX_TZ }) : json(task("t"), 200)));
    return updateTodo(ctx, { listId: "L/1", taskId: "T/1", patch }).then(() => {
      const sent = calls();
      expect(sent.some((c) => isMailboxZone(c.url))).toBe(typeof patch.dueDate === "string");
      return sent.find((c) => c.method === "PATCH")!;
    });
  }

  it("completes a task", async () => {
    const sent = await patchOf({ completed: true });
    expect(sent.method).toBe("PATCH");
    expect(sent.url).toBe("https://graph.microsoft.com/v1.0/me/todo/lists/L/1/tasks/T/1");
    expect(sent.body).toEqual({ status: "completed" });
  });

  it("encodes ids in the path", async () => {
    const fetchImpl = vi.fn(async () => json(task("t")));
    await updateTodo({ conn, fetchImpl: fetchImpl as unknown as typeof fetch }, {
      listId: "L/1",
      taskId: "T=1",
      patch: { title: "x" },
    });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://graph.microsoft.com/v1.0/me/todo/lists/L%2F1/tasks/T%3D1",
    );
  });

  it.each([
    { listId: "..", taskId: "T1" },
    { listId: "L1", taskId: "." },
  ])("refuses a dot-segment id (%j) as not found, before any request", async (ids) => {
    const fetchImpl = vi.fn(async () => json(task("t")));
    await expect(
      updateTodo({ conn, fetchImpl: fetchImpl as unknown as typeof fetch }, { ...ids, patch: { title: "x" } }),
    ).rejects.toMatchObject({ provider: "microsoft", status: 404 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("clears the due date", async () => {
    expect((await patchOf({ dueDate: null })).body).toEqual({ dueDateTime: null });
  });

  it("sends only the keys present", async () => {
    expect((await patchOf({ title: "T", notes: "N", completed: false, dueDate: "2026-11-01" })).body).toEqual({
      title: "T",
      body: { content: "N", contentType: "text" },
      status: "notStarted",
      dueDateTime: { dateTime: "2026-11-01T00:00:00", timeZone: MAILBOX_TZ },
    });
  });
});
