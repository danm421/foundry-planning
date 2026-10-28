// src/lib/workspace/microsoft/todo.ts
import type { WorkspaceTodo } from "../types";
import { graphJson, graphPages, type GraphContext } from "./graph";

type GraphList = { id: string; wellknownListName?: string };
type GraphTask = {
  id: string;
  title: string;
  dueDateTime?: { dateTime: string } | null;
  body?: { content?: string; contentType?: string } | null;
};

const toDueDateTime = (date: string | null) =>
  date === null ? null : { dateTime: `${date}T00:00:00`, timeZone: "UTC" };
const toBody = (notes: string) => ({ content: notes, contentType: "text" });
const taskPath = (listId: string) => `/me/todo/lists/${encodeURIComponent(listId)}/tasks`;
const jsonInit = (method: string, body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

function toWorkspaceTodo(listId: string, t: GraphTask): WorkspaceTodo {
  return {
    source: "outlook",
    id: t.id,
    listId,
    title: t.title,
    dueDate: t.dueDateTime ? t.dueDateTime.dateTime.slice(0, 10) : null,
    notes: t.body?.contentType === "text" ? (t.body.content ?? "") : "",
  };
}

/** Open tasks across every list except the flagged-emails list. */
export async function listOpenTodos(ctx: GraphContext): Promise<WorkspaceTodo[]> {
  const lists = await graphPages<GraphList>(ctx, "/me/todo/lists");
  const query = new URLSearchParams({ $filter: "status ne 'completed'", $top: "100" });
  const perList = await Promise.all(
    lists
      .filter((l) => l.wellknownListName !== "flaggedEmails")
      .map(async (l) => {
        const tasks = await graphPages<GraphTask>(ctx, `${taskPath(l.id)}?${query}`);
        return tasks.map((t) => toWorkspaceTodo(l.id, t));
      }),
  );
  return perList.flat();
}

/** Adds a task to the default list. */
export async function createTodo(
  ctx: GraphContext,
  input: { title: string; dueDate: string | null; notes: string },
): Promise<WorkspaceTodo> {
  const lists = await graphPages<GraphList>(ctx, "/me/todo/lists");
  const target = lists.find((l) => l.wellknownListName === "defaultList");
  if (!target) throw new Error("No default To Do list found");
  const body = {
    title: input.title,
    ...(input.dueDate ? { dueDateTime: toDueDateTime(input.dueDate) } : {}),
    body: toBody(input.notes),
  };
  const created = await graphJson<GraphTask>(ctx, taskPath(target.id), jsonInit("POST", body));
  return toWorkspaceTodo(target.id, created);
}

/** Changes only the fields present in `patch`. */
export async function updateTodo(
  ctx: GraphContext,
  input: {
    listId: string;
    taskId: string;
    patch: { title?: string; dueDate?: string | null; notes?: string; completed?: boolean };
  },
): Promise<void> {
  const { patch } = input;
  const body: Record<string, unknown> = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.dueDate !== undefined) body.dueDateTime = toDueDateTime(patch.dueDate);
  if (patch.notes !== undefined) body.body = toBody(patch.notes);
  if (patch.completed !== undefined) body.status = patch.completed ? "completed" : "notStarted";
  await graphJson<unknown>(ctx, `${taskPath(input.listId)}/${encodeURIComponent(input.taskId)}`, jsonInit("PATCH", body));
}
