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
  med: "bg-warn",
  low: "bg-ink-4",
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
  open: "border-hair-2 text-ink-2",
  in_progress: "border-accent-deep text-accent",
  blocked: "border-crit text-crit",
  done: "border-hair text-ink-3",
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
    <tr className="transition-colors duration-150 hover:bg-card-hover">
      <td className="whitespace-nowrap px-4 py-3 align-middle">
        <Link href={href} className="flex items-center gap-3 text-ink no-underline">
          <span
            aria-label={`${PRIORITY_LABEL[task.priority]} priority`}
            className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${PRIORITY_DOT_CLASS[task.priority]}`}
          />
          <span
            className={
              "truncate text-[13px] font-medium " +
              (isDone ? "text-ink-3 line-through" : "text-ink")
            }
          >
            {task.title}
          </span>
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-ink-2">
        <Link href={href} className="block">
          {task.householdName ?? "—"}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-ink-2">
        <Link href={href} className="block">
          {assigneeName ?? "Unassigned"}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[13px]">
        <Link
          href={href}
          className={"tabular block " + (due.overdue ? "text-crit" : "text-ink-2")}
        >
          {due.label}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-ink-3">
        <Link href={href} className="block">
          {PRIORITY_LABEL[task.priority]}
        </Link>
      </td>
      <td className="whitespace-nowrap px-4 py-3">
        <Link href={href} className="block">
          <span
            className={
              "inline-flex items-center rounded-[var(--radius-sm)] border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] " +
              STATUS_PILL_CLASS[task.status]
            }
          >
            {STATUS_LABEL[task.status]}
          </span>
        </Link>
      </td>
      <td className="tabular whitespace-nowrap px-4 py-3 text-right text-[13px] text-ink-3">
        <Link href={href} className="block">
          {interactionCount > 0 ? `⌁ ${interactionCount}` : ""}
        </Link>
      </td>
    </tr>
  );
}
