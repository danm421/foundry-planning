"use client";

import { useState } from "react";
import MoneyText from "@/components/money-text";

export type ProposalStatus = "draft" | "presented" | "accepted";

/** The columns the list needs. The full row carries a whole snapshot; the list
 *  reads six fields off it, so the caller narrows before passing them in. */
export interface ProposalListRow {
  id: string;
  name: string;
  targetLabel: string;
  status: ProposalStatus;
  totalValue: number;
  computedAt: string;
}

export interface ProposalListProps {
  rows: ProposalListRow[];
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}

const STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Draft",
  presented: "Presented",
  accepted: "Accepted",
};

/** UTC so the stamp reads the same for every advisor looking at the same
 *  proposal — an as-of date that shifts by timezone reads as a stale snapshot. */
const AS_OF_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

function StatusPill({ status }: { status: ProposalStatus }) {
  const tone: Record<ProposalStatus, string> = {
    draft: "text-ink-3 border-hair",
    presented: "text-ink-2 border-hair-2",
    accepted: "text-good border-good/30",
  };
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide ${tone[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function RowActions({
  row,
  onDuplicate,
  onDelete,
}: {
  row: ProposalListRow;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => onDelete(row.id)}
          aria-label={`Confirm delete of ${row.name}`}
          className="rounded-md border border-crit/40 px-2 py-1 text-xs font-medium text-crit hover:bg-crit/10"
        >
          Confirm
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-md border border-hair-2 px-2 py-1 text-xs text-ink-2 hover:bg-card-hover"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        type="button"
        onClick={() => onDuplicate(row.id)}
        aria-label={`Duplicate ${row.name}`}
        className="rounded-md border border-hair-2 px-2 py-1 text-xs text-ink-2 hover:bg-card-hover"
      >
        Duplicate
      </button>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${row.name}`}
        className="rounded-md border border-hair-2 px-2 py-1 text-xs text-ink-3 hover:border-crit/40 hover:text-crit"
      >
        Delete
      </button>
    </div>
  );
}

export function ProposalList({ rows, onOpen, onDuplicate, onDelete }: ProposalListProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-hair-2 bg-card p-8 text-center">
        <p className="text-sm text-ink-2">
          No proposals yet — build one to compare a client&rsquo;s portfolio against a model.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-hair-2 bg-card">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-hair-2">
            <th className="px-4 py-2.5 text-left font-medium text-ink-2">Name</th>
            <th className="px-4 py-2.5 text-left font-medium text-ink-2">Proposed portfolio</th>
            <th className="px-4 py-2.5 text-right font-medium text-ink-2">Value</th>
            <th className="px-4 py-2.5 text-left font-medium text-ink-2">Status</th>
            <th className="px-4 py-2.5 text-left font-medium text-ink-2">As of</th>
            <th className="px-4 py-2.5 text-right font-medium text-ink-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hair">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-2.5">
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="text-left font-medium text-ink hover:text-accent-ink"
                >
                  {row.name}
                </button>
              </td>
              <td className="px-4 py-2.5 text-ink-2">{row.targetLabel}</td>
              <td className="px-4 py-2.5 text-right">
                <MoneyText value={row.totalValue} format="currency" />
              </td>
              <td className="px-4 py-2.5">
                <StatusPill status={row.status} />
              </td>
              <td className="px-4 py-2.5">
                <span className="tabular text-[13px] text-ink-2">
                  {AS_OF_FMT.format(new Date(row.computedAt))}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <RowActions row={row} onDuplicate={onDuplicate} onDelete={onDelete} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
