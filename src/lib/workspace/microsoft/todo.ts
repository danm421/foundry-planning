// src/lib/workspace/microsoft/todo.ts
import type { WorkspaceTodo } from "../types";
import { mapLimited } from "../map-limited";
import { idSegment } from "../provider-http";
import { getMailboxTimeZone } from "./calendar";
import { graphJson, graphPages, jsonInit, type GraphContext } from "./graph";

type GraphList = { id: string; wellknownListName?: string };
type GraphTask = {
  id: string;
  title: string;
  dueDateTime?: { dateTime: string; timeZone?: string } | null;
  body?: { content?: string; contentType?: string } | null;
};

/** Outlook-service throttling allows 4 concurrent requests per app per mailbox. */
const MAX_LIST_READS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight in the mailbox's zone, so To Do shows the same day the advisor picked. */
const toDueDateTime = (date: string, timeZone: string) => ({ dateTime: `${date}T00:00:00`, timeZone });
const toBody = (notes: string) => ({ content: notes, contentType: "text" });
const taskPath = (listId: string) => `/me/todo/lists/${idSegment("microsoft", listId)}/tasks`;

/**
 * A due date as the mailbox's own day. To Do keeps a due date as the instant
 * of local midnight and answers in UTC (it doesn't document
 * `Prefer: outlook.timezone`, which events honour), so a UTC answer is that
 * midnight shifted by the mailbox's offset — −12 h to +12 h — and the nearest
 * UTC midnight is the same day. An answer in any other zone is already local.
 */
function toDueDate(due: { dateTime: string; timeZone?: string }): string {
  if (due.timeZone?.toUpperCase() !== "UTC") return due.dateTime.slice(0, 10);
  const instant = Date.parse(`${due.dateTime.slice(0, 19)}Z`);
  return new Date(Math.round(instant / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}

function toWorkspaceTodo(listId: string, t: GraphTask): WorkspaceTodo {
  const isText = t.body?.contentType === "text";
  return {
    provider: "microsoft",
    id: t.id,
    listId,
    title: t.title,
    dueDate: t.dueDateTime ? toDueDate(t.dueDateTime) : null,
    notes: isText ? (t.body?.content ?? "") : "",
    // Formatted (HTML) notes can't round-trip through a plain-text box.
    notesAreHtml: !isText && (t.body?.content ?? "").trim() !== "",
  };
}

/** Open tasks across every list except the flagged-emails list. */
export async function listOpenTodos(ctx: GraphContext): Promise<WorkspaceTodo[]> {
  const lists = await graphPages<GraphList>(ctx, "/me/todo/lists");
  const query = new URLSearchParams({ $filter: "status ne 'completed'", $top: "100" });
  const perList = await mapLimited(
    lists.filter((l) => l.wellknownListName !== "flaggedEmails"),
    MAX_LIST_READS,
    async (l) => {
      const tasks = await graphPages<GraphTask>(ctx, `${taskPath(l.id)}?${query}`);
      return tasks.map((t) => toWorkspaceTodo(l.id, t));
    },
  );
  return perList.flat();
}

/** Adds a task to the default list. */
export async function createTodo(
  ctx: GraphContext,
  input: { title: string; dueDate: string | null; notes: string },
): Promise<WorkspaceTodo> {
  const [lists, timeZone] = await Promise.all([
    graphPages<GraphList>(ctx, "/me/todo/lists"),
    input.dueDate ? getMailboxTimeZone(ctx) : null,
  ]);
  const target = lists.find((l) => l.wellknownListName === "defaultList");
  if (!target) throw new Error("No default To Do list found");
  const body = {
    title: input.title,
    ...(input.dueDate && timeZone ? { dueDateTime: toDueDateTime(input.dueDate, timeZone) } : {}),
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
  if (patch.dueDate !== undefined) {
    body.dueDateTime = patch.dueDate === null ? null : toDueDateTime(patch.dueDate, await getMailboxTimeZone(ctx));
  }
  if (patch.notes !== undefined) body.body = toBody(patch.notes);
  if (patch.completed !== undefined) body.status = patch.completed ? "completed" : "notStarted";
  await graphJson<unknown>(ctx, `${taskPath(input.listId)}/${idSegment("microsoft", input.taskId)}`, jsonInit("PATCH", body));
}
