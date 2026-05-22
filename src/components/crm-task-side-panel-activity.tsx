"use client";

export type CrmTaskActivityKind =
  | "created"
  | "status_changed"
  | "priority_changed"
  | "assignee_changed"
  | "household_changed"
  | "due_date_changed"
  | "start_date_changed"
  | "title_changed"
  | "description_changed"
  | "recurrence_changed"
  | "tags_changed"
  | "file_uploaded"
  | "file_deleted"
  | "completed"
  | "reopened"
  | "comment_posted";

export interface CrmTaskActivityRow {
  id: string;
  userId: string;
  /** Server-resolved actor name (`resolveActors`). Falls back to userId
   *  when the actor couldn't be resolved. */
  userName: string;
  kind: CrmTaskActivityKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface CrmTaskSidePanelActivityProps {
  rows: CrmTaskActivityRow[];
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec <= 1 ? "just now" : `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.round(mo / 12);
  return `${yr}y ago`;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

const KIND_LABEL: Record<CrmTaskActivityKind, (payload: Record<string, unknown>) => string> = {
  created: () => "created this task",
  status_changed: (p) => `changed status: ${asString(p.from) ?? "?"} → ${asString(p.to) ?? "?"}`,
  priority_changed: (p) => `changed priority: ${asString(p.from) ?? "?"} → ${asString(p.to) ?? "?"}`,
  assignee_changed: () => "changed assignee",
  household_changed: () => "changed household",
  due_date_changed: () => "changed due date",
  start_date_changed: () => "changed start date",
  title_changed: () => "changed title",
  description_changed: () => "changed description",
  recurrence_changed: () => "changed recurrence",
  tags_changed: (p) =>
    asString(p.action) === "attach" ? "attached a tag" : "detached a tag",
  file_uploaded: (p) => `uploaded file "${asString(p.filename) ?? ""}"`,
  file_deleted: (p) => `deleted file "${asString(p.filename) ?? ""}"`,
  completed: () => "completed this task",
  reopened: () => "reopened this task",
  comment_posted: () => "posted a comment",
};

export function CrmTaskSidePanelActivity({ rows }: CrmTaskSidePanelActivityProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-4 py-8 text-center">
        <p className="text-[13px] text-ink-3">No activity yet.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((row) => {
        const labelFn = KIND_LABEL[row.kind];
        const label = labelFn ? labelFn(row.payload ?? {}) : row.kind;
        return (
          <li
            key={row.id}
            className="flex items-baseline justify-between gap-3 border-b border-hair px-1 py-2 text-[12.5px] last:border-b-0"
          >
            <div className="min-w-0 flex-1">
              <span className="font-medium text-ink-2">{row.userName}</span>
              <span className="ml-1 text-ink-3">{label}</span>
            </div>
            <time
              dateTime={row.createdAt}
              title={new Date(row.createdAt).toLocaleString()}
              className="shrink-0 text-[11px] tabular-nums text-ink-3"
            >
              {relativeTime(row.createdAt)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
