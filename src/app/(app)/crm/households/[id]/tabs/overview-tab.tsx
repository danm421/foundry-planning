"use client";

import { useState } from "react";
import type { getCrmHousehold } from "@/lib/crm/households";
import { CrmHouseholdEditForm } from "@/components/crm-household-edit-form";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;

const STATUS_LABELS: Record<string, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

function fmtTimestamp(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function OverviewTab({ household }: { household: Household }) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius)] border border-hair bg-card p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
            Identity
          </h2>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
          >
            Edit
          </button>
        </div>

        <dl className="grid grid-cols-1 gap-y-4 sm:grid-cols-[140px_1fr] sm:gap-x-6">
          <dt className="text-[12px] font-medium text-ink-3">Name</dt>
          <dd className="text-[14px] text-ink">{household.name}</dd>

          <dt className="text-[12px] font-medium text-ink-3">Status</dt>
          <dd className="text-[14px] text-ink">
            {STATUS_LABELS[household.status] ?? household.status}
          </dd>

          <dt className="text-[12px] font-medium text-ink-3">Advisor</dt>
          <dd className="font-mono text-[12px] text-ink-2">{household.advisorId}</dd>

          <dt className="text-[12px] font-medium text-ink-3">Notes</dt>
          <dd className="whitespace-pre-wrap text-[14px] text-ink-2">
            {household.notes?.trim() ? household.notes : <span className="text-ink-3">—</span>}
          </dd>
        </dl>
      </section>

      <section className="rounded-[var(--radius)] border border-hair bg-card p-5">
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
          Timestamps
        </h2>
        <dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-[140px_1fr] sm:gap-x-6">
          <dt className="text-[12px] font-medium text-ink-3">Created</dt>
          <dd className="text-[14px] text-ink-2">{fmtTimestamp(household.createdAt)}</dd>

          <dt className="text-[12px] font-medium text-ink-3">Last updated</dt>
          <dd className="text-[14px] text-ink-2">{fmtTimestamp(household.updatedAt)}</dd>
        </dl>
      </section>

      <CrmHouseholdEditForm
        open={editOpen}
        onOpenChange={setEditOpen}
        householdId={household.id}
        initialName={household.name}
        initialStatus={household.status}
        initialNotes={household.notes}
      />
    </div>
  );
}
