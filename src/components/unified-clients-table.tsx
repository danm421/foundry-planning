"use client";

import { ClientRowActions } from "./client-row-actions";
import { HouseholdStatusSelect, HOUSEHOLD_STATUS_LABELS } from "./household-status-select";
import { HouseholdTrashActions } from "./household-trash-actions";
import { daysUntilPurge } from "@/lib/crm/trash";

export interface UnifiedClientRow {
  householdId: string;
  name: string;
  status: string;
  primaryName: string | null;
  spouseName: string | null;
  hasPlanning: boolean;
  planningClientId: string | null;
  updatedAt: string;
  deletedAt: string | null;
}

interface UnifiedClientsTableProps {
  rows: UnifiedClientRow[];
  /** Shown when `rows` is empty. Defaults to the "no clients yet" message. */
  emptyMessage?: string;
  /** Owner/admin — gates the per-row delete/restore menu. */
  canManage?: boolean;
}

// Widened so a row's plain-string status can index it (unknowns fall back below).
const STATUS_LABELS: Record<string, string> = HOUSEHOLD_STATUS_LABELS;

const TH =
  "px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-ink-3";

function dash(value: string | null) {
  return value && value.trim() ? value : <span className="text-ink-3">—</span>;
}

export function UnifiedClientsTable({ rows, emptyMessage, canManage }: UnifiedClientsTableProps) {
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
            <th className={TH}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {rows.map((r) => {
            return (
              <tr key={r.householdId} className="hover:bg-card-2">
                <td className="whitespace-nowrap px-6 py-4">
                  <span className="font-medium text-ink">{r.name}</span>
                  {r.deletedAt && (
                    <span className="mt-0.5 block text-xs text-ink-3">
                      In Trash · purges in {daysUntilPurge(r.deletedAt)} days
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-6 py-4">
                  <ClientRowActions
                    householdId={r.householdId}
                    planningClientId={r.planningClientId}
                  />
                </td>
                <td className="whitespace-nowrap px-6 py-4 text-sm text-ink-2">
                  {r.deletedAt ? (
                    STATUS_LABELS[r.status] ?? r.status
                  ) : (
                    <HouseholdStatusSelect
                      // Remount when the server-confirmed status changes so the
                      // select's optimistic local value re-seeds from fresh data.
                      key={r.status}
                      householdId={r.householdId}
                      householdName={r.name}
                      status={r.status}
                    />
                  )}
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
                <td className="whitespace-nowrap px-6 py-4 text-right">
                  {canManage && (
                    <HouseholdTrashActions
                      householdId={r.householdId}
                      householdName={r.name}
                      deleted={Boolean(r.deletedAt)}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
