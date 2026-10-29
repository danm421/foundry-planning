// src/lib/workspace/todo-groups.ts
import type { TaskListRow } from "@/lib/crm-tasks/queries";
import type { WorkspaceTodo } from "./types";
import { addDays, mondayOf } from "./week";

/**
 * The Workspace to-do list's pure half: Foundry tasks and Outlook to-dos as one
 * kind of row, filed by due date. Dates are `YYYY-MM-DD` strings, which compare
 * in calendar order as text.
 */

/** One row of the combined list. `outlook` / `foundry` carry the ids the source's routes take. */
export type TodoItem = {
  key: string;
  source: "outlook" | "foundry";
  title: string;
  dueDate: string | null;
  meta: string | null;
  href: string | null;
  outlook?: { listId: string; taskId: string };
  foundry?: { taskId: string };
};

export type TodoGroups = {
  overdue: TodoItem[];
  today: TodoItem[];
  thisWeek: TodoItem[];
  later: TodoItem[];
  noDate: TodoItem[];
};

/** `"Nguyen household · High"`: the household, then the priority only when it's high. */
function foundryMeta(t: TaskListRow): string | null {
  const parts = [t.householdName, t.priority === "high" ? "High" : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function toTodoItems(foundry: TaskListRow[], outlook: WorkspaceTodo[]): TodoItem[] {
  return [
    ...foundry.map(
      (t): TodoItem => ({
        key: `foundry:${t.id}`,
        source: "foundry",
        title: t.title,
        dueDate: t.dueDate,
        meta: foundryMeta(t),
        href: `/tasks?task=${encodeURIComponent(t.id)}`,
        foundry: { taskId: t.id },
      }),
    ),
    ...outlook.map(
      (t): TodoItem => ({
        key: `outlook:${t.listId}:${t.id}`,
        source: "outlook",
        title: t.title,
        dueDate: t.dueDate,
        meta: null,
        href: null,
        outlook: { listId: t.listId, taskId: t.id },
      }),
    ),
  ];
}

const byDueThenTitle = (a: TodoItem, b: TodoItem) =>
  (a.dueDate ?? "").localeCompare(b.dueDate ?? "") || a.title.localeCompare(b.title);

/** Files each item by its due date against `today`. "This week" runs from tomorrow through Sunday. */
export function groupTodos(items: TodoItem[], today: string): TodoGroups {
  const sunday = addDays(mondayOf(today), 6);
  const groups: TodoGroups = { overdue: [], today: [], thisWeek: [], later: [], noDate: [] };
  for (const item of items) {
    const due = item.dueDate;
    const group =
      due === null
        ? groups.noDate
        : due < today
          ? groups.overdue
          : due === today
            ? groups.today
            : due <= sunday
              ? groups.thisWeek
              : groups.later;
    group.push(item);
  }
  for (const group of Object.values(groups)) group.sort(byDueThenTitle);
  return groups;
}
