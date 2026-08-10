"use client";

import { useState, type ReactElement, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import PersonAvatar from "@/components/portal/person-avatar";
import EditableCard from "@/components/portal/editable-card";
import HouseholdContactDialog, {
  ROLE_LABEL,
  type ContactRole,
  type PortalContact,
} from "@/components/portal/household-contact-dialog";
import { PencilIcon } from "@/components/portal/portal-icons";

/**
 * The two principal cards at the top of Organizer → Household.
 *
 * The whole card is the affordance — clicking it opens the edit dialog — so the
 * card renders as a `<button>` when editing is enabled and a plain `<div>` when
 * it is not. That keeps a read-only portal from advertising a control the client
 * cannot use, and avoids a focusable element that does nothing.
 */
export default function HouseholdContactCards({
  primary,
  spouse,
  editEnabled,
}: {
  primary: PortalContact | null;
  spouse: PortalContact | null;
  editEnabled: boolean;
}): ReactElement {
  const router = useRouter();
  const [editing, setEditing] = useState<ContactRole | null>(null);

  const slots: { role: ContactRole; contact: PortalContact }[] = [];
  if (primary) slots.push({ role: "primary", contact: primary });
  if (spouse) slots.push({ role: "spouse", contact: spouse });

  const openContact = editing === "primary" ? primary : spouse;

  return (
    <>
      {slots.length === 0 ? (
        <p className="text-[13px] text-ink-3">
          No contact details on file yet — your advisor will add them.
        </p>
      ) : (
        // `auto-fit`, not `sm:grid-cols-2`: the breakpoint is viewport-wide, but
        // this column is narrowed by the portal rail and the advisor preview's
        // fixed 240px sidebar — at a 640px viewport the content column is only
        // ~398px, and a media-query 2-up truncated both names to "C..". Sizing
        // off the container instead keeps the cards readable wherever they land.
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">
          {slots.map(({ role, contact }) => (
            <ContactCard
              key={role}
              role={role}
              contact={contact}
              editEnabled={editEnabled}
              onEdit={() => setEditing(role)}
            />
          ))}
        </div>
      )}

      {editing && openContact && (
        <HouseholdContactDialog
          role={editing}
          contact={openContact}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function ContactCard({
  role,
  contact,
  editEnabled,
  onEdit,
}: {
  role: ContactRole;
  contact: PortalContact;
  editEnabled: boolean;
  onEdit: () => void;
}): ReactElement {
  const fullName = [contact.firstName, contact.lastName]
    .filter(Boolean)
    .join(" ");

  return (
    <EditableCard
      editEnabled={editEnabled}
      onEdit={onEdit}
      ariaLabel={`Edit ${fullName}`}
      className="block w-full rounded-[var(--radius)] border border-hair bg-card p-5 text-left"
    >
      <div className="flex items-start gap-4">
        <PersonAvatar firstName={contact.firstName} lastName={contact.lastName} />
        <div className="min-w-0 flex-1">
          <span className="chip">{ROLE_LABEL[role]}</span>
          <h3 className="mt-2 truncate text-[15px] font-medium text-ink">
            {fullName}
          </h3>
          <div className="mt-2 space-y-1">
            <Detail label="Email" value={contact.email} editEnabled={editEnabled} />
            <Detail label="Phone" value={contact.phone} mono editEnabled={editEnabled} />
          </div>
        </div>
        {editEnabled && (
          <PencilIcon className="mt-0.5 shrink-0 text-ink-4 transition-colors group-hover:text-accent" />
        )}
      </div>
    </EditableCard>
  );
}

function Detail({
  label,
  value,
  mono,
  editEnabled,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  editEnabled: boolean;
}): ReactNode {
  if (!value) {
    // Nothing on file. Only worth a placeholder when the client can act on it —
    // otherwise the card just shows what it has.
    if (!editEnabled) return null;
    return (
      <div className="text-[13px] text-ink-4">Add {label.toLowerCase()}</div>
    );
  }
  return (
    <div className={`truncate text-[13px] text-ink-2 ${mono ? "tabular" : ""}`}>
      <span className="sr-only">{label}: </span>
      {value}
    </div>
  );
}
