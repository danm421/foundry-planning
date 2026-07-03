import Link from "next/link";

import type { TaskListRow } from "@/lib/crm-tasks/queries";
import { formatDueDate } from "@/lib/crm-tasks/format";

interface CrmTaskRowProps {
  task: TaskListRow;
  /** Path prefix that the side-panel deep-link appends `?task=<id>` onto.
   *  Lets the same row work from `/crm/tasks` or `/crm/households/[id]`. */
  hrefBase: string;
  /** Resolved assignee display name; null when the task is unassigned. */
  assigneeName: string | null;
}

const PRIORITY_DOT_CLASS: Record<TaskListRow["priority"], string> = {
  high: "bg-crit",
  med: "bg-amber-500",
  low: "bg-slate-400",
};

const PRIORITY_LABEL: Record<TaskListRow["priority"], string> = {
  high: "High",
  med: "Med",
  low: "Low",
};

const STATUS_LABEL: Record<TaskListRow["status"], string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
};

const STATUS_PILL_CLASS: Record<TaskListRow["status"], string> = {
  open: "border-hair text-ink-2 bg-card-2",
  in_progress: "border-accent/40 text-accent bg-accent/10",
  blocked: "border-crit/40 text-crit bg-crit/10",
  done: "border-hair text-ink-3 bg-card-2",
};

/**
 * Single row in `<CrmTaskTable>`. Purely presentational — the entire row
 * is a single deep-link to the side panel via `?task=<id>`.
 */
export function CrmTaskRow({ task, hrefBase, assigneeName }: CrmTaskRowProps) {
  const sep = hrefBase.includes("?") ? "&" : "?";
  const href = `${hrefBase}${sep}task=${task.id}`;
  const due = formatDueDate(task.dueDate);
  const isDone = task.status === "done";
  const interactionCount = task.commentCount + task.fileCount;

  return (
    <tr className="hover:bg-card-2">
      <td className="whitespace-nowrap px-4 py-3 align-middle">
        <Link href={href} className="flex items-center gap-3 text-ink no-underline">
          <span
            aria-label={`${PRIORITY_LABEL[task.priority]} priority`}
            className={`inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT_CLASS[task.priority]}`}
          />
          <span
            className={
              "truncate text-[14px] font-medium " +
              (isDone ? "text-ink-3 line-through" : "text-ink")
            }
          >
            {task.title}
          </span>
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-2">
        <Link href={href} className="block">
          {task.householdName ?? "—"}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-2">
        <Link href={href} className="block">
          {assigneeName ?? "Unassigned"}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm">
        <Link
          href={href}
          className={"block tabular-nums " + (due.overdue ? "text-crit" : "text-ink-2")}
        >
          {due.label}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-sm text-ink-3">
        <Link href={href} className="block">
          {PRIORITY_LABEL[task.priority]}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <Link href={href} className="block">
          <span
            className={
              "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide " +
              STATUS_PILL_CLASS[task.status]
            }
          >
            {STATUS_LABEL[task.status]}
          </span>
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-ink-3 tabular-nums">
        <Link href={href} className="block">
          {interactionCount > 0 ? `⌁ ${interactionCount}` : ""}
        </Link>
      </td>
    </tr>
  );
}
