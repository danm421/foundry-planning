"use client";

import { useState } from "react";
import Link from "next/link";
import type { getCrmHousehold } from "@/lib/crm/households";
import type { HouseholdRelationshipView } from "@/lib/crm/household-relationships";
import { CrmHouseholdEditForm } from "@/components/crm-household-edit-form";
import { USPS_STATE_NAMES, isUSPSStateCode } from "@/lib/usps-states";
import { chipClass } from "@/components/crm-section-primitives";

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

export function OverviewTab({
  household,
  advisorName,
  relationships,
}: {
  household: Household;
  advisorName: string;
  relationships: HouseholdRelationshipView[];
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="space-y-6">
      <section className="rounded-[var(--radius)] border border-hair bg-card p-5">
        <div className="mb-4 flex items-baseline gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
            Identity
          </h2>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="text-[11px] font-medium uppercase tracking-[1.2px] text-ink-3 transition-colors hover:text-accent"
          >
            Edit
          </button>
        </div>

        <dl className="grid grid-cols-1 gap-y-4 sm:grid-cols-[96px_1fr] sm:gap-x-4">
          <dt className="text-[12px] font-medium text-ink-3">Name</dt>
          <dd className="text-[14px] text-ink">{household.name}</dd>

          <dt className="text-[12px] font-medium text-ink-3">Status</dt>
          <dd className="text-[14px] text-ink">
            {STATUS_LABELS[household.status] ?? household.status}
          </dd>

          <dt className="text-[12px] font-medium text-ink-3">State</dt>
          <dd className="text-[14px] text-ink-2">
            {isUSPSStateCode(household.state)
              ? USPS_STATE_NAMES[household.state]
              : <span className="text-ink-3">—</span>}
          </dd>

          <dt className="text-[12px] font-medium text-ink-3">Advisor</dt>
          <dd className="text-[14px] text-ink-2">{advisorName}</dd>

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
        <dl className="grid grid-cols-1 gap-y-3 sm:grid-cols-[96px_1fr] sm:gap-x-4">
          <dt className="text-[12px] font-medium text-ink-3">Created</dt>
          <dd className="text-[14px] text-ink-2">{fmtTimestamp(household.createdAt)}</dd>

          <dt className="text-[12px] font-medium text-ink-3">Last updated</dt>
          <dd className="text-[14px] text-ink-2">{fmtTimestamp(household.updatedAt)}</dd>
        </dl>
      </section>

      {relationships.length > 0 && (
        <section className="rounded-[var(--radius)] border border-hair bg-card p-5">
          <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
            Related households
          </h2>
          <ul className="space-y-2.5">
            {relationships.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2">
                <span className={chipClass}>{r.label}</span>
                <Link
                  href={`/crm/households/${r.counterpart.id}`}
                  className="text-[14px] font-medium text-ink transition-colors hover:text-accent-ink"
                >
                  {r.counterpart.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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
