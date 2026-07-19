"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CrmLinkHouseholdDialog } from "@/components/crm-link-household-dialog";
import { OverflowMenu } from "@/components/overflow-menu";
import { HOUSEHOLD_STATUS_LABELS } from "@/components/household-status-select";
import { chipClass, sectionHeadingClass, addGhostClass, EmptyState } from "@/components/crm-section-primitives";
import type { HouseholdRelationshipView } from "@/lib/crm/household-relationships";

const statusBadgeClass =
  "shrink-0 rounded-full border border-hair px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-3";

function RelationshipCard({
  relationship,
  onUnlink,
  unlinking,
}: {
  relationship: HouseholdRelationshipView;
  onUnlink: () => void;
  unlinking: boolean;
}) {
  return (
    <li className="rounded-[var(--radius)] border border-hair bg-card p-4 transition-colors hover:border-hair-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={chipClass}>{relationship.label}</span>
            <Link
              href={`/crm/households/${relationship.counterpart.id}`}
              className="text-[14px] font-medium text-ink transition-colors hover:text-accent-ink"
            >
              {relationship.counterpart.name}
            </Link>
            <span className={statusBadgeClass}>
              {(HOUSEHOLD_STATUS_LABELS as Record<string, string>)[relationship.counterpart.status] ??
                relationship.counterpart.status}
            </span>
          </div>

          {relationship.note && (
            <p className="mt-1.5 text-[12.5px] text-ink-2">{relationship.note}</p>
          )}
        </div>

        <OverflowMenu
          triggerLabel={`Actions for ${relationship.counterpart.name}`}
          minWidthClassName="min-w-[140px]"
          items={[
            { label: "Unlink", variant: "destructive", disabled: unlinking, onClick: onUnlink },
          ]}
        />
      </div>
    </li>
  );
}

export function CrmHouseholdRelationshipsSection({
  householdId,
  relationships,
}: {
  householdId: string;
  relationships: HouseholdRelationshipView[];
}) {
  const router = useRouter();
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null);

  async function runUnlink(relationship: HouseholdRelationshipView) {
    setUnlinkingId(relationship.id);
    try {
      const res = await fetch(
        `/api/crm/households/${householdId}/relationships/${relationship.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`Unlink failed (${res.status})`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unlink failed");
    } finally {
      setUnlinkingId(null);
    }
  }

  function unlink(relationship: HouseholdRelationshipView) {
    if (
      !confirm("Remove the link between these households? Neither household is deleted.")
    ) {
      return;
    }
    void runUnlink(relationship);
  }

  return (
    <section aria-labelledby="related-households-heading" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="related-households-heading" className={sectionHeadingClass}>
          Related households ({relationships.length})
        </h2>
        <button type="button" onClick={() => setLinkDialogOpen(true)} className={addGhostClass}>
          Link household
        </button>
      </div>

      {relationships.length === 0 ? (
        <EmptyState>No related households yet.</EmptyState>
      ) : (
        <ul className="space-y-2.5">
          {relationships.map((r) => (
            <RelationshipCard
              key={r.id}
              relationship={r}
              onUnlink={() => unlink(r)}
              unlinking={unlinkingId === r.id}
            />
          ))}
        </ul>
      )}

      <CrmLinkHouseholdDialog
        householdId={householdId}
        excludeIds={[householdId, ...relationships.map((r) => r.counterpart.id)]}
        open={linkDialogOpen}
        onClose={() => setLinkDialogOpen(false)}
        onLinked={() => router.refresh()}
      />
    </section>
  );
}
