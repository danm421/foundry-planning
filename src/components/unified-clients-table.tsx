"use client";

import { ClientRowActions } from "./client-row-actions";
import { ClientsSortHeader, TH } from "./clients-sort-header";
import { HouseholdStatusSelect, HOUSEHOLD_STATUS_LABELS } from "./household-status-select";
import { HouseholdTrashActions } from "./household-trash-actions";
import { daysUntilPurge } from "@/lib/crm/trash";
import type { ClientSortKey, SortDir } from "@/lib/crm/sort";

export interface UnifiedClientRow {
  householdId: string;
  name: string;
  status: string;
  primaryName: string | null;
  spouseName: string | null;
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
  /** Active sort, for header state. Omit to render all headers unsorted. */
  sort?: { key: ClientSortKey | null; dir: SortDir };
}

// Widened so a row's plain-string status can index it (unknowns fall back below).
const STATUS_LABELS: Record<string, string> = HOUSEHOLD_STATUS_LABELS;

/**
 * Body-cell padding, declared once for the same reason `TH` is: the colgroup
 * budgets each column's content width as `col width − TD padding`, so a cell
 * that drifts to its own padding silently breaks that arithmetic.
 */
const TD = "px-4 py-3";
/** `TD` plus the secondary-text treatment most data cells share. */
const TD_TEXT = `${TD} text-sm text-ink-2`;

function dash(value: string | null) {
  return value && value.trim() ? value : <span className="text-ink-3">—</span>;
}

export function UnifiedClientsTable({ rows, emptyMessage, canManage, sort }: UnifiedClientsTableProps) {
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
    <div className="mt-4 overflow-x-auto rounded-lg border border-hair bg-card shadow-sm">
      {/*
        `table-fixed` + this colgroup is what keeps the list on one screen: every
        column is budgeted, so long values ellipsize instead of the whole table
        growing past the viewport. The `min-w` floor keeps those budgets readable
        on narrow windows — below it the CARD scrolls, rather than the page
        bleeding off to the right.

        The LAST column is the flexible one, and that is the whole layout. Give
        the slack to Name instead and every data column drifts right with it,
        stranding the quick-link pills a long way from the name they belong to.
        Anchoring it here packs the data columns left at their natural widths and
        pools the leftover space at the card's edge, behind the right-aligned
        row menu.

        Two widths are pinned to content that lives in OTHER files and cannot
        ellipsize its way out of an overflow, so they carry deliberate slack —
        measured in-browser, not eyeballed:
          · quick links (208px) — `ClientRowActions`' widest state is the
            "CRM" + "Start planning" pill pair.
          · status (176px) — `HouseholdStatusSelect` is a fixed `w-32` (128px).
        Widening that copy, that select, or the row font means re-measuring both.
      */}
      <table className="w-full min-w-[1112px] table-fixed divide-y divide-hair">
        <colgroup>
          <col className="w-[236px]" />
          <col className="w-[216px]" />
          <col className="w-[176px]" />
          <col className="w-[148px]" />
          <col className="w-[148px]" />
          <col className="w-[136px]" />
          <col />
        </colgroup>
        <thead className="bg-card-2">
          <tr>
            <ClientsSortHeader
              sortKey="name"
              label="Name"
              srLabel="Sort by last name"
              activeKey={sort?.key ?? null}
              activeDir={sort?.dir ?? "asc"}
            />
            {/* `relative` matters: `sr-only` is position:absolute, and without a
                positioned ancestor INSIDE the scrolling card it resolves against
                a distant one — landing past the viewport and scrolling the whole
                PAGE whenever the table is wider than the card. */}
            <th className={`${TH} relative`}>
              <span className="sr-only">Quick links</span>
            </th>
            <ClientsSortHeader
              sortKey="status"
              label="Status"
              srLabel="Sort by status"
              activeKey={sort?.key ?? null}
              activeDir={sort?.dir ?? "asc"}
            />
            <ClientsSortHeader
              sortKey="primary"
              // Shortened from "Primary contact" so the header fits its column
              // without wrapping; `srLabel` keeps the full meaning for AT.
              label="Primary"
              srLabel="Sort by primary contact last name"
              activeKey={sort?.key ?? null}
              activeDir={sort?.dir ?? "asc"}
            />
            <ClientsSortHeader
              sortKey="spouse"
              label="Spouse"
              srLabel="Sort by spouse last name"
              activeKey={sort?.key ?? null}
              activeDir={sort?.dir ?? "asc"}
            />
            <ClientsSortHeader
              sortKey="updated"
              label="Updated"
              srLabel="Sort by last updated"
              activeKey={sort?.key ?? null}
              activeDir={sort?.dir ?? "asc"}
            />
            {/* Always rendered: this is the flexible column that pools the
                slack, so it must exist even when there is no row menu in it.
                `relative` for the same reason as the quick-links header. */}
            <th className={`${TH} relative`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {rows.map((r) => {
            return (
              <tr key={r.householdId} className="hover:bg-card-2">
                <td className={TD}>
                  <span className="block truncate text-sm font-medium text-ink" title={r.name}>
                    {r.name}
                  </span>
                  {r.deletedAt && (
                    <span className="mt-0.5 block truncate text-xs text-ink-3">
                      In Trash · purges in {daysUntilPurge(r.deletedAt)} days
                    </span>
                  )}
                </td>
                <td className={`${TD} whitespace-nowrap`}>
                  <ClientRowActions
                    householdId={r.householdId}
                    planningClientId={r.planningClientId}
                  />
                </td>
                <td className={`${TD_TEXT} whitespace-nowrap`}>
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
                <td className={`${TD_TEXT} truncate`}>
                  {dash(r.primaryName)}
                </td>
                <td className={`${TD_TEXT} truncate`}>
                  {dash(r.spouseName)}
                </td>
                <td className={`${TD} tabular whitespace-nowrap text-sm text-ink-3`}>
                  {new Date(r.updatedAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td className={`${TD} whitespace-nowrap text-right`}>
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
