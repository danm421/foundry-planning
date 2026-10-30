// src/lib/workspace/google/tasks.ts
import { mapLimited } from "../map-limited";
import type { TodoPatch } from "../provider-adapter";
import type { WorkspaceTodo } from "../types";
import { googleJson, googlePages, jsonInit, type GoogleContext } from "./api";

const TASKS_BASE = "https://tasks.googleapis.com/tasks/v1";
const DEFAULT_LIST = "@default";
const MAX_LIST_READS = 4;

type GoogleTask = { id: string; title?: string; due?: string | null; notes?: string };

/** `@default` is Google's alias for the default list, a literal segment (`encodeURIComponent` would turn its `@` into `%40`). */
const listTasksUrl = (listId: string) =>
  `${TASKS_BASE}/lists/${listId === DEFAULT_LIST ? DEFAULT_LIST : encodeURIComponent(listId)}/tasks`;

/** Google keeps a due date as a UTC-midnight timestamp. */
const toDue = (date: string) => `${date}T00:00:00.000Z`;

function toWorkspaceTodo(listId: string, t: GoogleTask): WorkspaceTodo {
  return {
    provider: "google",
    id: t.id,
    listId,
    title: t.title ?? "",
    dueDate: t.due?.slice(0, 10) ?? null,
    notes: t.notes ?? "",
    notesAreHtml: false,
  };
}

/** Open tasks across every list. */
export async function listOpenTodos(ctx: GoogleContext): Promise<WorkspaceTodo[]> {
  const lists = await googlePages<{ id: string }>(ctx, `${TASKS_BASE}/users/@me/lists?maxResults=100`);
  const query = new URLSearchParams({ showCompleted: "false", showHidden: "false", maxResults: "100" });
  const perList = await mapLimited(lists, MAX_LIST_READS, async (l) => {
    const tasks = await googlePages<GoogleTask>(ctx, `${listTasksUrl(l.id)}?${query}`);
    return tasks.map((t) => toWorkspaceTodo(l.id, t));
  });
  return perList.flat();
}

/** Adds a task to the default list. */
export async function createTodo(
  ctx: GoogleContext,
  input: { title: string; dueDate: string | null; notes: string },
): Promise<WorkspaceTodo> {
  const body = {
    title: input.title,
    notes: input.notes,
    ...(input.dueDate ? { due: toDue(input.dueDate) } : {}),
  };
  const created = await googleJson<GoogleTask>(ctx, listTasksUrl(DEFAULT_LIST), jsonInit("POST", body));
  return toWorkspaceTodo(DEFAULT_LIST, created);
}

/** Edits, completes or reopens a task. */
export async function updateTodo(
  ctx: GoogleContext,
  input: { listId: string; taskId: string; patch: TodoPatch },
): Promise<void> {
  const { patch } = input;
  const body = {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.dueDate !== undefined ? { due: patch.dueDate === null ? null : toDue(patch.dueDate) } : {}),
    ...(patch.completed !== undefined ? { status: patch.completed ? "completed" : "needsAction" } : {}),
  };
  const url = `${listTasksUrl(input.listId)}/${encodeURIComponent(input.taskId)}`;
  await googleJson<void>(ctx, url, jsonInit("PATCH", body));
}
