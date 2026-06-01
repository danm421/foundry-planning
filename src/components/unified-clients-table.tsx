"use client";

import { ClientRowActions } from "./client-row-actions";

export interface UnifiedClientRow {
  householdId: string;
  name: string;
  status: string;
  primaryName: string | null;
  spouseName: string | null;
  hasPlanning: boolean;
  planningClientId: string | null;
  updatedAt: string;
}

interface UnifiedClientsTableProps {
  rows: UnifiedClientRow[];
  /** Shown when `rows` is empty. Defaults to the "no clients yet" message. */
  emptyMessage?: string;
}

const STATUS_LABELS: Record<string, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

const TH =
  "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3";

function dash(value: string | null) {
  return value && value.trim() ? value : <span className="text-ink-3">—</span>;
}

export function UnifiedClientsTable({ rows, emptyMessage }: UnifiedClientsTableProps) {
  if (rows.length === 0) {
    return (
      <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
        <div className="px-6 py-12 text-center">
          <p className="text-ink-3">
            {emptyMessage ?? 'No clients yet. Click "New household" to add one.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-hair bg-card shadow-sm">
      <table className="min-w-full divide-y divide-hair">
        <thead className="bg-card-2">
          <tr>
            <th className={TH}>Name</th>
            <th className={TH}>
              <span className="sr-only">Quick links</span>
            </th>
            <th className={TH}>Status</th>
            <th className={TH}>Primary contact</th>
            <th className={TH}>Spouse</th>
            <th className={TH}>Planning</th>
            <th className={TH}>Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {rows.map((r) => {
            return (
              <tr key={r.householdId} className="hover:bg-card-2">
                <td className="whitespace-nowrap px-6 py-4">
                  <span className="font-medium text-ink">{r.name}</span>
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <ClientRowActions
                    householdId={r.householdId}
                    planningClientId={r.planningClientId}
                  />
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                  {STATUS_LABELS[r.status] ?? r.status}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                  {dash(r.primaryName)}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                  {dash(r.spouseName)}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm">
                  {r.hasPlanning ? (
                    <span className="inline-flex items-center rounded-full bg-ok/15 px-2 py-0.5 text-[11px] font-medium text-ok">
                      Planning
                    </span>
                  ) : (
                    <span className="text-ink-3">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-3">
                  {new Date(r.updatedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
