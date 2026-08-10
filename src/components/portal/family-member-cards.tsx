"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import PersonAvatar from "@/components/portal/person-avatar";
import EditableCard from "@/components/portal/editable-card";
import FamilyMemberDialog, {
  type PortalFamilyMember,
} from "@/components/portal/family-member-dialog";
import { familyRelationshipLabel } from "@/lib/family-relationships";

type Editing = { mode: "add" } | { mode: "edit"; member: PortalFamilyMember };

/**
 * Organizer → Household → Family. A card per person, each one a button that
 * opens the same dialog the "Add person" button opens in create mode.
 */
export default function FamilyMemberCards({
  rows,
  editEnabled,
}: {
  rows: PortalFamilyMember[];
  editEnabled: boolean;
}): ReactElement {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);

  return (
    <div>
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold text-ink">Family</h2>
        {editEnabled && (
          <button
            type="button"
            onClick={() => setEditing({ mode: "add" })}
            className="btn-ghost shrink-0 whitespace-nowrap h-9 px-3 text-[13px] font-medium"
          >
            Add person
          </button>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="text-[13px] text-ink-3">No family members yet.</p>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {rows.map((m) => (
            <MemberCard
              key={m.id}
              member={m}
              editEnabled={editEnabled}
              onEdit={() => setEditing({ mode: "edit", member: m })}
            />
          ))}
        </div>
      )}

      {editing && (
        <FamilyMemberDialog
          member={editing.mode === "edit" ? editing.member : undefined}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function MemberCard({
  member,
  editEnabled,
  onEdit,
}: {
  member: PortalFamilyMember;
  editEnabled: boolean;
  onEdit: () => void;
}): ReactElement {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(" ");
  const dob = formatDob(member.dateOfBirth);

  return (
    <EditableCard
      editEnabled={editEnabled}
      onEdit={onEdit}
      ariaLabel={`Edit ${fullName}`}
      className="flex flex-col items-center rounded-[var(--radius)] border border-hair bg-card p-4 text-center"
    >
      <PersonAvatar
        firstName={member.firstName}
        lastName={member.lastName}
        size="sm"
      />
      <div className="mt-3 w-full truncate text-[14px] font-medium text-ink">
        {fullName}
      </div>
      <div className="mt-0.5 text-[12px] text-ink-3">
        {familyRelationshipLabel(member.relationship)}
      </div>
      {dob && <div className="mt-1 text-[12px] text-ink-4 tabular">{dob}</div>}
    </EditableCard>
  );
}

/** `YYYY-MM-DD` → `M/D/YYYY`, split on the string rather than parsed as a Date:
 *  `new Date("1998-04-02")` is UTC midnight and renders as the previous day for
 *  anyone west of Greenwich. */
function formatDob(iso: string | null): string | null {
  if (!iso) return null;
  const [y, m, d] = iso.split("-");
  if (!y || !m || !d) return iso;
  return `${Number(m)}/${Number(d)}/${y}`;
}
