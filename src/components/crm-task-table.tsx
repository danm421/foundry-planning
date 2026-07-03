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
      <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
        <div className="px-6 py-12 text-center">
          <p className="text-ink-3">No tasks yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
      <table className="min-w-full divide-y divide-hair">
        <thead className="bg-card-2">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
              Title
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
              Household
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
              Assignee
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
              Due
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
              Priority
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
              Status
            </th>
            <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-ink-3">
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
