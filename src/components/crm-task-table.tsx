import type { TaskListRow } from "@/lib/crm-tasks/queries";
import type { FirmMember } from "@/lib/crm-tasks/members";
import { CrmTaskRow } from "./crm-task-row";

interface CrmTaskTableProps {
  rows: TaskListRow[];
  /** Path prefix used by each row's deep-link. */
  hrefBase: string;
  /** Firm members used to resolve assignee ids to display names. */
  members: FirmMember[];
}

/**
 * Renders the task list as a table with consistent density relative to
 * `<CrmHouseholdTable>`. Empty state lives inline so the surrounding page
 * chrome (filters, "New task" button) remains.
 */
export function CrmTaskTable({ rows, hrefBase, members }: CrmTaskTableProps) {
  const nameByUserId = new Map(members.map((m) => [m.userId, m.displayName]));
  if (rows.length === 0) {
    return (
      <div className="mt-4 overflow-hidden rounded-[var(--radius)] border border-hair-2 bg-card">
        <div className="px-6 py-12 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            No tasks yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-x-auto rounded-[var(--radius)] border border-hair-2 bg-card">
      <table className="min-w-full">
        <thead className="border-b border-hair-2 bg-card-2">
          <tr>
            <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Title
            </th>
            <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Household
            </th>
            <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Assignee
            </th>
            <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Due
            </th>
            <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Priority
            </th>
            <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              Status
            </th>
            <th className="px-4 py-2.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-3">
              <span aria-label="Comments and files">⌁</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {rows.map((row) => (
            <CrmTaskRow
              key={row.id}
              task={row}
              hrefBase={hrefBase}
              assigneeName={
                row.assigneeUserId
                  ? nameByUserId.get(row.assigneeUserId) ?? row.assigneeUserId
                  : null
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
