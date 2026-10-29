"use client";

import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import Link from "next/link";
import { checkboxClassName } from "@/components/forms/input-styles";
import type { TaskListRow } from "@/lib/crm-tasks/queries";
import { groupTodos, toTodoItems, type TodoGroups, type TodoItem } from "@/lib/workspace/todo-groups";
import type { OutlookError, WorkspaceTodo } from "@/lib/workspace/types";
import { localToday, monthDay } from "@/lib/workspace/week";
import { AddTodoRow, type HouseholdOption, type TodoDraft } from "./add-todo-row";
import { CONNECT_URL } from "./calendar-pane-state";
import { TodoEditorDialog, type TodoPatch } from "./todo-editor-dialog";

type Loaded = {
  foundry: TaskListRow[];
  outlook: WorkspaceTodo[] | null;
  outlookError: OutlookError | null;
  today: string;
};
type ListState = { kind: "loading" } | { kind: "error" } | ({ kind: "ready" } & Loaded);

const CHECK_FAILED = "Couldn't mark it done. Try again.";

const GROUPS: [keyof TodoGroups, string][] = [
  ["overdue", "Overdue"],
  ["today", "Today"],
  ["thisWeek", "This week"],
  ["later", "Later"],
  ["noDate", "No date"],
];

const NOTICE = "mb-3 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2.5 py-1.5 text-[12px] text-ink-2";
const CHIP =
  "ml-1.5 inline-block rounded-full border border-hair-2 px-1.5 align-[1px] font-mono text-[9px] uppercase leading-[1.5] tracking-[0.08em] text-ink-3";

const todoUrl = (o: { listId: string; taskId: string }) =>
  `/api/workspace/todos/${encodeURIComponent(o.listId)}/${encodeURIComponent(o.taskId)}`;

/**
 * Reads both halves of the list. A 500, a network failure or an answer
 * without Foundry's half is an error the panel says out loud, never an empty
 * list; Microsoft's own failures arrive inside a 200 as `outlookError`.
 */
async function loadTodos(signal: AbortSignal): Promise<ListState> {
  try {
    const res = await fetch("/api/workspace/todos", { signal });
    if (res.ok) {
      const body = (await res.json()) as Partial<Loaded> | null;
      if (Array.isArray(body?.foundry) && (body.outlook === null || Array.isArray(body.outlook))) {
        return {
          kind: "ready",
          foundry: body.foundry,
          outlook: body.outlook,
          outlookError: body.outlookError ?? null,
          today: localToday(),
        };
      }
    }
  } catch {
    // Falls through to the error.
  }
  return { kind: "error" };
}

/** One write. Resolves to the answer's body, or null when it failed. */
async function send(url: string, method: "POST" | "PATCH", body: unknown): Promise<{ body: unknown } | null> {
  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok ? { body: await res.json().catch(() => null) } : null;
  } catch {
    return null;
  }
}

/** Marks an item done at its source. */
function complete(item: TodoItem): Promise<{ body: unknown } | null> {
  if (item.outlook) return send(todoUrl(item.outlook), "PATCH", { completed: true });
  if (item.foundry) {
    return send(`/api/crm/tasks/${encodeURIComponent(item.foundry.taskId)}/status`, "POST", { status: "done" });
  }
  return Promise.resolve(null);
}

/** `Oct 28`, with the year when it isn't this year's. */
function dueLabel(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? monthDay(date) : `${monthDay(date)}, ${date.slice(0, 4)}`;
}

const withKey = (set: ReadonlySet<string>, key: string) => new Set(set).add(key);
function withoutKey(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  next.delete(key);
  return next;
}

/**
 * The advisor's open Outlook to-dos and Foundry tasks in one list, filed by
 * due date. It reads its own route, so it works beside every calendar state:
 * Foundry tasks show before Microsoft is connected, and `outlookError` says
 * why Outlook's half is missing.
 */
export function TodoPanel({
  userId,
  households,
}: {
  userId: string;
  households: HouseholdOption[];
}): ReactElement {
  const ids = useId();
  const [list, setList] = useState<ListState>({ kind: "loading" });
  // A re-read keeps the list on screen until its answer replaces it.
  const [reads, setReads] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    void loadTodos(ctrl.signal).then((r) => {
      if (!ctrl.signal.aborted) setList(r);
    });
    return () => ctrl.abort();
  }, [reads]);
  const reread = () => setReads((n) => n + 1);

  // Check-offs: in flight (the row fades), finished (the row is gone, even
  // from a re-read sent before it landed), failed (the row says so). The ref
  // turns away a second click before the first one's render lands.
  const inFlight = useRef(new Set<string>());
  const [checking, setChecking] = useState<ReadonlySet<string>>(new Set());
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set());

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<WorkspaceTodo | null>(null);

  async function checkOff(item: TodoItem): Promise<void> {
    if (inFlight.current.has(item.key)) return;
    inFlight.current.add(item.key);
    setChecking((s) => withKey(s, item.key));
    setFailed((s) => withoutKey(s, item.key));

    const r = await complete(item);
    inFlight.current.delete(item.key);
    setChecking((s) => withoutKey(s, item.key));
    if (!r) {
      setFailed((s) => withKey(s, item.key));
      return;
    }
    setDone((s) => withKey(s, item.key));
    // A recurring Foundry task now has its next one, which only a re-read shows.
    if ((r.body as { followOnId?: unknown } | null)?.followOnId) reread();
  }

  async function addTodo(d: TodoDraft): Promise<void> {
    const r = d.foundry
      ? await send("/api/crm/tasks", "POST", {
          title: d.title,
          dueDate: d.dueDate,
          priority: d.foundry.priority,
          householdId: d.foundry.householdId,
          assigneeUserId: userId,
        })
      : await send("/api/workspace/todos", "POST", { title: d.title, dueDate: d.dueDate, notes: "" });
    if (!r) throw new Error("add failed"); // the row says so and stays open
    setAdding(false);
    reread();
  }

  async function saveTodo(todo: WorkspaceTodo, patch: TodoPatch): Promise<void> {
    const r = await send(todoUrl({ listId: todo.listId, taskId: todo.id }), "PATCH", patch);
    if (!r) throw new Error("save failed"); // the dialog says so and stays open
    setEditing(null);
    reread();
  }

  const ready = list.kind === "ready" ? list : null;
  const items = ready ? toTodoItems(ready.foundry, ready.outlook ?? []).filter((i) => !done.has(i.key)) : [];
  const groups = ready ? groupTodos(items, ready.today) : null;
  const openCount = items.filter((i) => !checking.has(i.key)).length;
  // No working Outlook connection: a new to-do can only be a Foundry task.
  const foundryOnly = ready?.outlookError === "not_connected" || ready?.outlookError === "needs_reconnect";

  function openTodo(item: TodoItem) {
    const o = item.outlook;
    const todo = o && ready?.outlook?.find((t) => t.listId === o.listId && t.id === o.taskId);
    if (todo) setEditing(todo);
  }

  return (
    <aside aria-label="To-dos" className="rounded-xl border border-hair bg-card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">To-dos</h2>
        {ready ? <span className="tabular text-[11px] text-ink-3">{openCount} open</span> : null}
      </div>

      {list.kind === "loading" ? (
        <p role="status" className="py-6 text-center text-[13px] text-ink-3">
          Loading your to-dos…
        </p>
      ) : list.kind === "error" ? (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p role="alert" className="text-[13px] text-ink-2">
            Couldn&apos;t load your to-dos.
          </p>
          <button
            type="button"
            className="btn-ghost text-sm"
            onClick={() => {
              setList({ kind: "loading" });
              reread();
            }}
          >
            Retry
          </button>
        </div>
      ) : groups && ready ? (
        <>
          {ready.outlookError === "needs_reconnect" ? (
            <p className={NOTICE}>
              <a href={CONNECT_URL} className="underline underline-offset-2 hover:text-ink">
                Reconnect Microsoft 365 to see your Outlook to-dos.
              </a>
            </p>
          ) : ready.outlookError === "throttled" ? (
            <p className={NOTICE}>Outlook to-dos are unavailable right now.</p>
          ) : null}

          {adding ? (
            <AddTodoRow
              foundryOnly={foundryOnly}
              households={households}
              onAdd={addTodo}
              onCancel={() => setAdding(false)}
            />
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="mb-3 w-full rounded-[var(--radius-sm)] border border-dashed border-hair-2 px-2.5 py-2 text-left text-[13px] text-ink-3 transition-colors hover:border-ink-4 hover:text-ink-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              + Add a to-do
            </button>
          )}

          {items.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-ink-3">Nothing open.</p>
          ) : (
            GROUPS.map(([key, label]) =>
              groups[key].length > 0 ? (
                <section key={key} aria-labelledby={`${ids}-${key}`} className="mt-3">
                  <h3
                    id={`${ids}-${key}`}
                    className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3"
                  >
                    {label}
                  </h3>
                  <ul>
                    {groups[key].map((item) => (
                      <TodoRow
                        key={item.key}
                        item={item}
                        today={ready.today}
                        pending={checking.has(item.key)}
                        failed={failed.has(item.key)}
                        onCheck={() => void checkOff(item)}
                        onOpen={() => openTodo(item)}
                      />
                    ))}
                  </ul>
                </section>
              ) : null,
            )
          )}
        </>
      ) : null}

      {editing ? (
        <TodoEditorDialog
          todo={editing}
          onSave={(patch) => saveTodo(editing, patch)}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </aside>
  );
}

function TodoRow({
  item,
  today,
  pending,
  failed,
  onCheck,
  onOpen,
}: {
  item: TodoItem;
  today: string;
  pending: boolean;
  failed: boolean;
  onCheck: () => void;
  onOpen: () => void;
}): ReactElement {
  const titleClass =
    "text-left text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
  return (
    <li
      className={`flex items-start gap-2.5 border-t border-hair py-2.5 first:border-t-0 motion-safe:transition-opacity motion-safe:duration-200 ${
        pending ? "opacity-40" : ""
      }`}
    >
      <input
        type="checkbox"
        aria-label={`Mark ${item.title} done`}
        className={`${checkboxClassName} mt-0.5 shrink-0`}
        checked={pending}
        disabled={pending}
        onChange={onCheck}
      />
      <div className="min-w-0 flex-1">
        <p className="break-words text-[13px] leading-[1.4]">
          {item.href ? (
            <Link href={item.href} className={titleClass}>
              {item.title}
            </Link>
          ) : (
            <button type="button" aria-haspopup="dialog" className={titleClass} onClick={onOpen}>
              {item.title}
            </button>
          )}
          <span className={CHIP}>{item.source === "outlook" ? "Outlook" : "Foundry"}</span>
        </p>
        {item.meta || item.dueDate ? (
          <p className="mt-0.5 text-[11px] text-ink-3">
            {item.meta ? <span>{item.meta}</span> : null}
            {item.meta && item.dueDate ? " · " : null}
            {item.dueDate ? (
              <>
                Due <span className="tabular">{dueLabel(item.dueDate, today)}</span>
              </>
            ) : null}
          </p>
        ) : null}
        {failed ? (
          <p role="alert" className="mt-1 text-[12px] text-crit">
            {CHECK_FAILED}
          </p>
        ) : null}
      </div>
    </li>
  );
}
