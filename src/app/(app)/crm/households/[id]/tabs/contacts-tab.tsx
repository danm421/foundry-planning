"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { getCrmHousehold } from "@/lib/crm/households";
import { CrmContactForm, type CrmContactFormInitial } from "@/components/crm-contact-form";
import {
  CrmFamilyMemberForm,
  RELATIONSHIP_OPTIONS,
  type FamilyMemberFormInitial,
} from "@/components/crm-family-member-form";
import {
  CrmExternalContactForm,
  type ExternalContactFormInitial,
} from "@/components/crm-external-contact-form";
import {
  CrmPromoteFamilyMemberDialog,
  type CrmPromoteFamilyMemberInitial,
} from "@/components/crm-promote-family-member-dialog";
import { OverflowMenu } from "@/components/overflow-menu";
import { CrmHouseholdRelationshipsSection } from "@/components/crm-household-relationships-section";
import type { HouseholdRelationshipView } from "@/lib/crm/household-relationships";
import { deriveContactSections } from "@/lib/crm/contact-sections";
import { ageOnDate } from "@/lib/age-year";
import { TrashIcon } from "@/components/icons";
import { chipClass, sectionHeadingClass, addGhostClass, EmptyState } from "@/components/crm-section-primitives";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;
type Contact = Household["contacts"][number];
type FamilyMember = NonNullable<Household["planningClient"]>["familyMembers"][number];

// Only primary/spouse rows are rendered through this map now — dependents show
// their planning relationship and role `other` shows its free-text label.
const ROLE_LABELS: Record<string, string> = {
  primary: "Primary",
  spouse: "Spouse",
};

/** Verdigris pill — identity roles (primary / spouse) only. */
const roleBadgeClass =
  "rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent";

const addPrimaryClass =
  "rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-on transition-colors hover:bg-accent-ink";

function fmtDob(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

const relationshipLabel = (value: string) =>
  RELATIONSHIP_OPTIONS.find((o) => o.value === value)?.label ?? "Family";

/** "Apr 2, 2015 · 11" — DOB with the current age trailing it. */
function dobRow(iso: string | null | undefined): ReactNode | null {
  if (!iso) return null;
  const formatted = fmtDob(iso);
  if (!formatted) return null;
  // Calendar-precise and TZ-safe: ageOnDate slices the ISO string rather than
  // Date.parse-ing it, which is what keeps Jan-1 DOBs from reading a year young.
  const years = ageOnDate(iso, new Date());
  return (
    <span className="tabular">
      {years === null ? formatted : `${formatted} · ${years}`}
    </span>
  );
}

function addressLine(c: Contact): string {
  const parts = [
    [c.addressLine1, c.addressLine2].filter(Boolean).join(" "),
    [c.city, c.state].filter(Boolean).join(", "),
    c.postalCode,
    c.country,
  ].filter((v) => v && String(v).trim().length > 0);
  return parts.join(" · ");
}

function phoneLine(c: { phone: string | null; mobile: string | null }): string {
  return [c.phone, c.mobile].filter(Boolean).join(" · ");
}

function toInitial(c: Contact): CrmContactFormInitial {
  return {
    id: c.id,
    role: c.role,
    firstName: c.firstName,
    lastName: c.lastName,
    preferredName: c.preferredName,
    dateOfBirth: c.dateOfBirth,
    email: c.email,
    phone: c.phone,
    mobile: c.mobile,
    addressLine1: c.addressLine1,
    addressLine2: c.addressLine2,
    city: c.city,
    state: c.state,
    postalCode: c.postalCode,
    country: c.country,
    ssnLast4: c.ssnLast4,
    notes: c.notes,
  };
}

type Row = { label: string; value: ReactNode };

function rowsOf(...rows: (Row | null)[]): Row[] {
  return rows.filter((r): r is Row => r !== null && r.value !== null && r.value !== "");
}

const EMPTY_PROMOTE_INITIAL: CrmPromoteFamilyMemberInitial = {
  firstName: "",
  lastName: "",
  dateOfBirth: null,
  email: null,
  phone: null,
  mobile: null,
};

function ContactCard({
  badge,
  name,
  preferredName,
  rows,
  onEdit,
  onDelete,
  deleting,
  menu,
}: {
  badge: ReactNode;
  name: string;
  preferredName?: string | null;
  rows: Row[];
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  menu?: ReactNode;
}) {
  const preferred = preferredName?.trim();
  return (
    <li className="rounded-[var(--radius)] border border-hair bg-card p-4 transition-colors hover:border-hair-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {badge}
            <span className="text-[14px] font-medium text-ink">
              {name}
              {preferred ? (
                <span className="ml-1 text-[13px] text-ink-3">({preferred})</span>
              ) : null}
            </span>
          </div>

          {rows.length > 0 && (
            <dl className="mt-2.5 grid grid-cols-1 gap-y-1 text-[12.5px] text-ink-2 sm:grid-cols-[110px_1fr] sm:gap-x-3">
              {rows.map((row) => (
                <Fragment key={row.label}>
                  <dt className="text-ink-3">{row.label}</dt>
                  <dd className="min-w-0 truncate">{row.value}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label={`Edit ${name}`}
            className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            aria-label={`Delete ${name}`}
            className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-crit/15 hover:text-crit disabled:opacity-50"
          >
            <TrashIcon width={14} height={14} aria-hidden="true" />
          </button>
          {menu}
        </div>
      </div>
    </li>
  );
}

export function ContactsTab({
  household,
  relationships,
}: {
  household: Household;
  relationships: HouseholdRelationshipView[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  // Every dialog opener bumps this and passes it as the dialog's `key`, so each
  // open is a fresh mount. That does two things the dialogs can't do for
  // themselves: (1) a failed save on record A can't leave its error banner up
  // when the dialog is next opened for record B (none of the three forms clear
  // their `error` state on close, and DialogShell keeps the form component
  // mounted); (2) CrmFamilyMemberForm's `createdMemberIdRef` — which must
  // survive failed submits *within* one open dialog — can never leak into the
  // next record. Dialog state below is stored as a single nullable object so
  // `open` and `initialValues` always change together; initialValues is never
  // swapped while the dialog stays open.
  const [dialogInstance, setDialogInstance] = useState(0);
  const nextInstance = () => setDialogInstance((n) => n + 1);

  const [contactDialog, setContactDialog] = useState<Contact | null>(null);
  const [familyDialog, setFamilyDialog] = useState<{
    planningClientId: string | null;
    initialValues?: FamilyMemberFormInitial;
  } | null>(null);
  const [externalDialog, setExternalDialog] = useState<{
    initialValues?: ExternalContactFormInitial;
  } | null>(null);
  const [promoteDialog, setPromoteDialog] = useState<CrmPromoteFamilyMemberInitial | null>(null);

  // sourceFamilyMemberId -> the household it was promoted into. Only edges
  // that came from a family-member promote carry sourceFamilyMemberId; plain
  // household links (CrmLinkHouseholdDialog) don't populate it.
  const promotedByMemberId = useMemo(
    () =>
      new Map(
        relationships
          .filter((r) => r.sourceFamilyMemberId)
          .map((r) => [r.sourceFamilyMemberId as string, r.counterpart.id]),
      ),
    [relationships],
  );

  const existingRoles = useMemo(() => {
    const set = new Set<"primary" | "spouse">();
    for (const c of household.contacts) {
      if (c.role === "primary" || c.role === "spouse") set.add(c.role);
    }
    return set;
  }, [household.contacts]);

  const planningClientId = household.planningClient?.id ?? null;

  const sections = deriveContactSections(
    household.contacts,
    household.planningClient?.familyMembers ?? [],
  );
  // primarySpouse renders INSIDE the Family section (see :373 below), so it
  // counts. Omitting it made a household with just a primary + spouse — the
  // default state of every new household — read "Family (0)" above two visible
  // cards, with "No family members yet" underneath them.
  const familyCount =
    sections.primarySpouse.length + sections.family.length + sections.unlinkedFamily.length;
  const hasFamilyRows = sections.family.length > 0 || sections.unlinkedFamily.length > 0;

  function openContactEdit(contact: Contact) {
    nextInstance();
    setContactDialog(contact);
  }

  function openFamilyCreate() {
    nextInstance();
    setFamilyDialog({ planningClientId });
  }

  function openFamilyEdit(entry: { member: FamilyMember; contact: Contact | null }) {
    nextInstance();
    setFamilyDialog({
      planningClientId,
      initialValues: {
        memberId: entry.member.id,
        contactId: entry.contact?.id,
        firstName: entry.member.firstName,
        lastName: entry.member.lastName ?? "",
        relationship: entry.member.relationship,
        dateOfBirth: entry.member.dateOfBirth,
        email: entry.contact?.email ?? null,
        phone: entry.contact?.phone ?? null,
        mobile: entry.contact?.mobile ?? null,
        notes: entry.contact?.notes ?? null,
      },
    });
  }

  /** Unlinked dependents have no planning row to update, so the dialog opens in
   *  contact-only mode (planningClientId = null) even when the household has a
   *  planning client — otherwise a save would POST a brand-new family member
   *  the contact row still wouldn't be linked to. */
  function openUnlinkedEdit(contact: Contact) {
    nextInstance();
    setFamilyDialog({
      planningClientId: null,
      initialValues: {
        contactId: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        relationship: null,
        dateOfBirth: contact.dateOfBirth,
        email: contact.email,
        phone: contact.phone,
        mobile: contact.mobile,
        notes: contact.notes,
      },
    });
  }

  function openExternalCreate() {
    nextInstance();
    setExternalDialog({});
  }

  function openPromote(initial: CrmPromoteFamilyMemberInitial) {
    nextInstance();
    setPromoteDialog(initial);
  }

  function openExternalEdit(contact: Contact) {
    nextInstance();
    setExternalDialog({
      initialValues: {
        id: contact.id,
        firstName: contact.firstName,
        lastName: contact.lastName,
        relationshipLabel: contact.relationshipLabel,
        email: contact.email,
        phone: contact.phone,
        mobile: contact.mobile,
        addressLine1: contact.addressLine1,
        addressLine2: contact.addressLine2,
        city: contact.city,
        state: contact.state,
        postalCode: contact.postalCode,
        country: contact.country,
        notes: contact.notes,
      },
    });
  }

  async function runDelete(id: string, url: string) {
    setBusy(id);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  /** CRM-only delete — the contact row and nothing else. */
  function deleteContact(contact: Contact) {
    const name = `${contact.firstName} ${contact.lastName}`.trim();
    if (!confirm(`Remove ${name}?`)) return;
    void runDelete(
      contact.id,
      `/api/crm/households/${household.id}/contacts/${contact.id}`,
    );
  }

  /** Linked family delete — removes the planning row; the linked CRM contact
   *  goes with it via the family_member_id cascade. */
  function deleteFamilyMember(member: FamilyMember) {
    if (!planningClientId) return;
    const name = `${member.firstName} ${member.lastName ?? ""}`.trim();
    if (
      !confirm(
        `Remove ${name}? This also removes them from planning; will/beneficiary references are cleaned up.`,
      )
    ) {
      return;
    }
    void runDelete(
      member.id,
      `/api/clients/${planningClientId}/family-members/${member.id}`,
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
      <section aria-labelledby="contacts-family-heading" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 id="contacts-family-heading" className={sectionHeadingClass}>
            Family ({familyCount})
          </h2>
          <button type="button" onClick={openFamilyCreate} className={addPrimaryClass}>
            Add family member
          </button>
        </div>

        {sections.primarySpouse.length > 0 && (
          <ul className="space-y-2.5">
            {sections.primarySpouse.map((c) => (
              <ContactCard
                key={c.id}
                badge={<span className={roleBadgeClass}>{ROLE_LABELS[c.role] ?? c.role}</span>}
                name={`${c.firstName} ${c.lastName}`.trim()}
                preferredName={c.preferredName}
                rows={rowsOf(
                  { label: "DOB", value: dobRow(c.dateOfBirth) },
                  { label: "Email", value: c.email },
                  { label: "Phone", value: phoneLine(c) },
                  c.ssnLast4
                    ? {
                        label: "SSN",
                        value: <span className="tabular">***-**-{c.ssnLast4}</span>,
                      }
                    : null,
                  { label: "Address", value: addressLine(c) },
                )}
                onEdit={() => openContactEdit(c)}
                onDelete={() => deleteContact(c)}
                deleting={busy === c.id}
              />
            ))}
          </ul>
        )}

        {familyCount === 0 && (
          <EmptyState>No family members yet. Add one here or in planning.</EmptyState>
        )}

        {hasFamilyRows && (
          <ul className="space-y-2.5">
            {sections.family.map(({ member, contact }) => {
              const promotedHouseholdId = promotedByMemberId.get(member.id);
              return (
                <ContactCard
                  key={member.id}
                  badge={
                    <span className={chipClass}>{relationshipLabel(member.relationship)}</span>
                  }
                  name={`${member.firstName} ${member.lastName ?? ""}`.trim()}
                  preferredName={contact?.preferredName}
                  rows={rowsOf(
                    { label: "DOB", value: dobRow(member.dateOfBirth) },
                    { label: "Email", value: contact?.email ?? null },
                    {
                      label: "Phone",
                      value: contact ? phoneLine(contact) : null,
                    },
                    { label: "Notes", value: contact?.notes ?? null },
                  )}
                  onEdit={() => openFamilyEdit({ member, contact })}
                  onDelete={() => deleteFamilyMember(member)}
                  deleting={busy === member.id}
                  menu={
                    <OverflowMenu
                      triggerLabel="More actions"
                      minWidthClassName="min-w-[170px]"
                      items={
                        promotedHouseholdId
                          ? [
                              {
                                label: "View household",
                                href: `/crm/households/${promotedHouseholdId}`,
                              },
                            ]
                          : [
                              {
                                label: "Promote to household…",
                                onClick: () =>
                                  openPromote({
                                    sourceFamilyMemberId: member.id,
                                    firstName: member.firstName,
                                    lastName: member.lastName ?? "",
                                    dateOfBirth: member.dateOfBirth,
                                    email: contact?.email ?? null,
                                    phone: contact?.phone ?? null,
                                    mobile: contact?.mobile ?? null,
                                  }),
                              },
                            ]
                      }
                    />
                  }
                />
              );
            })}

            {sections.unlinkedFamily.map((c) => (
              <ContactCard
                key={c.id}
                badge={<span className={chipClass}>Dependent</span>}
                name={`${c.firstName} ${c.lastName}`.trim()}
                preferredName={c.preferredName}
                rows={rowsOf(
                  { label: "DOB", value: dobRow(c.dateOfBirth) },
                  { label: "Email", value: c.email },
                  { label: "Phone", value: phoneLine(c) },
                  { label: "Notes", value: c.notes },
                )}
                onEdit={() => openUnlinkedEdit(c)}
                onDelete={() => deleteContact(c)}
                deleting={busy === c.id}
                menu={
                  <OverflowMenu
                    triggerLabel="More actions"
                    minWidthClassName="min-w-[170px]"
                    items={[
                      {
                        label: "Promote to household…",
                        onClick: () =>
                          openPromote({
                            firstName: c.firstName,
                            lastName: c.lastName,
                            dateOfBirth: c.dateOfBirth,
                            email: c.email,
                            phone: c.phone,
                            mobile: c.mobile,
                          }),
                      },
                    ]}
                  />
                }
              />
            ))}
          </ul>
        )}
      </section>

      <div className="space-y-6">
        <section aria-labelledby="contacts-external-heading" className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 id="contacts-external-heading" className={sectionHeadingClass}>
              External contacts ({sections.external.length})
            </h2>
            <button type="button" onClick={openExternalCreate} className={addGhostClass}>
              Add external contact
            </button>
          </div>

          {sections.external.length === 0 ? (
            <EmptyState>No external contacts yet.</EmptyState>
          ) : (
            <ul className="space-y-2.5">
              {sections.external.map((c) => (
                <ContactCard
                  key={c.id}
                  badge={
                    c.relationshipLabel ? (
                      <span className={chipClass}>{c.relationshipLabel}</span>
                    ) : null
                  }
                  name={`${c.firstName} ${c.lastName}`.trim()}
                  rows={rowsOf(
                    { label: "Email", value: c.email },
                    { label: "Phone", value: phoneLine(c) },
                    { label: "Notes", value: c.notes },
                  )}
                  onEdit={() => openExternalEdit(c)}
                  onDelete={() => deleteContact(c)}
                  deleting={busy === c.id}
                />
              ))}
            </ul>
          )}
        </section>

        <CrmHouseholdRelationshipsSection
          householdId={household.id}
          relationships={relationships}
        />
      </div>

      <CrmContactForm
        key={`contact-${dialogInstance}`}
        open={contactDialog !== null}
        onOpenChange={(open) => {
          if (!open) setContactDialog(null);
        }}
        householdId={household.id}
        existingRoles={existingRoles}
        mode="edit"
        initialValues={contactDialog ? toInitial(contactDialog) : undefined}
        onSaved={() => router.refresh()}
      />

      <CrmFamilyMemberForm
        key={`family-${dialogInstance}`}
        open={familyDialog !== null}
        onOpenChange={(open) => {
          if (!open) setFamilyDialog(null);
        }}
        householdId={household.id}
        planningClientId={familyDialog?.planningClientId ?? null}
        mode={familyDialog?.initialValues ? "edit" : "create"}
        initialValues={familyDialog?.initialValues}
        onSaved={() => router.refresh()}
      />

      <CrmExternalContactForm
        key={`external-${dialogInstance}`}
        open={externalDialog !== null}
        onOpenChange={(open) => {
          if (!open) setExternalDialog(null);
        }}
        householdId={household.id}
        mode={externalDialog?.initialValues ? "edit" : "create"}
        initialValues={externalDialog?.initialValues}
        onSaved={() => router.refresh()}
      />

      <CrmPromoteFamilyMemberDialog
        key={`promote-${dialogInstance}`}
        sourceHouseholdId={household.id}
        defaultState={household.state}
        initial={promoteDialog ?? EMPTY_PROMOTE_INITIAL}
        open={promoteDialog !== null}
        onClose={() => setPromoteDialog(null)}
      />
    </div>
  );
}
