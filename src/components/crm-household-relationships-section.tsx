"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CrmLinkHouseholdDialog } from "@/components/crm-link-household-dialog";
import type { HouseholdRelationshipView } from "@/lib/crm/household-relationships";

const STATUS_LABELS: Record<string, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

const sectionHeadingClass =
  "text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3";
const addGhostClass =
  "rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-1.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink";
/** Hairline pill — descriptive relationship label, same idiom as the family
 *  section's relationship chip (contacts-tab.tsx's relBadgeClass). */
const chipClass =
  "rounded-full border border-hair-2 bg-card-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-3";
const statusBadgeClass =
  "shrink-0 rounded-full border border-hair px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-3";

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-6 py-8 text-center">
      <p className="text-[13px] text-ink-3">{children}</p>
    </div>
  );
}

function RelationshipCard({
  relationship,
  onUnlink,
  unlinking,
}: {
  relationship: HouseholdRelationshipView;
  onUnlink: () => void;
  unlinking: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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
              {STATUS_LABELS[relationship.counterpart.status] ?? relationship.counterpart.status}
            </span>
          </div>

          {relationship.note && (
            <p className="mt-1.5 text-[12.5px] text-ink-2">{relationship.note}</p>
          )}
        </div>

        <div ref={wrapperRef} className="relative shrink-0">
          <button
            type="button"
            aria-label={`Actions for ${relationship.counterpart.name}`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-card-2 hover:text-ink"
          >
            ⋯
          </button>

          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-30 mt-1.5 min-w-[140px] rounded-[var(--radius-sm)] border border-hair bg-paper p-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                disabled={unlinking}
                onClick={() => {
                  setMenuOpen(false);
                  onUnlink();
                }}
                className="block w-full rounded-[var(--radius-sm)] px-3 py-1.5 text-left text-[13px] text-crit transition-colors hover:bg-crit/10 disabled:opacity-50"
              >
                Unlink
              </button>
            </div>
          )}
        </div>
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
