"use client";

import { useState } from "react";
import Link from "next/link";
import type { getCrmHousehold } from "@/lib/crm/households";
import type { HouseholdRelationshipView } from "@/lib/crm/household-relationships";
import { CrmHouseholdEditForm } from "@/components/crm-household-edit-form";
import { deriveHouseholdNameFromContacts } from "@/lib/crm/household-name";
import { USPS_STATE_NAMES, isUSPSStateCode } from "@/lib/usps-states";
import {
  DetailList,
  DetailRow,
  Missing,
  SectionLabel,
  chipClass,
  panelClass,
} from "@/components/crm-section-primitives";
import { Household360 } from "./insights/household-360";

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
  planningClientId,
}: {
  household: Household;
  advisorName: string;
  relationships: HouseholdRelationshipView[];
  /** Linked planning client. Null households have no 360 to show. */
  planningClientId: string | null;
}) {
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <section className={`${panelClass} p-5`}>
        <SectionLabel segments={["Identity", "Household record"]}>
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-3 transition-colors duration-150 hover:text-accent"
          >
            Edit
          </button>
        </SectionLabel>

        <div className="mt-3 grid gap-x-8 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
          <DetailList>
            <DetailRow label="Name">{household.name}</DetailRow>
            <DetailRow label="Status">
              {STATUS_LABELS[household.status] ?? household.status}
            </DetailRow>
            <DetailRow label="State">
              {isUSPSStateCode(household.state) ? (
                USPS_STATE_NAMES[household.state]
              ) : (
                <Missing />
              )}
            </DetailRow>
          </DetailList>

          <DetailList>
            <DetailRow label="Advisor">{advisorName}</DetailRow>
            <DetailRow label="Created">
              <span className="tabular">{fmtTimestamp(household.createdAt)}</span>
            </DetailRow>
            <DetailRow label="Updated">
              <span className="tabular">{fmtTimestamp(household.updatedAt)}</span>
            </DetailRow>
          </DetailList>
        </div>

        <div className="border-t border-hair">
          <DetailList>
            <DetailRow label="Notes">
              {household.notes?.trim() ? (
                <span className="whitespace-pre-wrap text-ink-2">{household.notes}</span>
              ) : (
                <Missing />
              )}
            </DetailRow>
          </DetailList>
        </div>
      </section>

      {planningClientId ? (
        <Household360 clientId={planningClientId} />
      ) : (
        <section className="flex flex-col gap-4">
          <SectionLabel segments={["360", "Client snapshot"]} />
          <div className="rounded-[var(--radius)] border border-dashed border-hair-2 px-6 py-8 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
              No planning client linked — start planning to unlock the 360
            </p>
          </div>
        </section>
      )}

      {relationships.length > 0 && (
        <section className={`${panelClass} p-5`}>
          <SectionLabel
            segments={["Related", `${relationships.length} households`]}
          />
          <ul className="mt-3">
            {relationships.map((r, i) => (
              <li
                key={r.id}
                className={`flex flex-wrap items-center gap-2.5 py-3 ${
                  i === relationships.length - 1 ? "" : "border-b border-hair"
                }`}
              >
                <span className={chipClass}>{r.label}</span>
                <Link
                  href={`/crm/households/${r.counterpart.id}`}
                  className="text-[13.5px] font-medium text-ink transition-colors duration-150 hover:text-accent"
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
        initialNameIsCustom={household.nameIsCustom}
        derivedName={deriveHouseholdNameFromContacts(household.contacts)}
      />
    </div>
  );
}
