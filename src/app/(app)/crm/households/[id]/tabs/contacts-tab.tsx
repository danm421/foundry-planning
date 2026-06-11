"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { getCrmHousehold } from "@/lib/crm/households";
import { CrmContactForm, type CrmContactFormInitial } from "@/components/crm-contact-form";
import { TrashIcon } from "@/components/icons";

type Household = NonNullable<Awaited<ReturnType<typeof getCrmHousehold>>>;
type Contact = Household["contacts"][number];

const ROLE_LABELS: Record<string, string> = {
  primary: "Primary",
  spouse: "Spouse",
  dependent: "Dependent",
  other: "Other",
};

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

function addressLine(c: Contact): string {
  const parts = [
    [c.addressLine1, c.addressLine2].filter(Boolean).join(" "),
    [c.city, c.state].filter(Boolean).join(", "),
    c.postalCode,
    c.country,
  ].filter((v) => v && String(v).trim().length > 0);
  return parts.join(" · ");
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

export function ContactsTab({ household }: { household: Household }) {
  const router = useRouter();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const existingRoles = useMemo(() => {
    const set = new Set<"primary" | "spouse">();
    for (const c of household.contacts) {
      if (c.role === "primary" || c.role === "spouse") set.add(c.role);
    }
    return set;
  }, [household.contacts]);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(contact: Contact) {
    setEditing(contact);
    setFormOpen(true);
  }

  async function onDelete(contact: Contact) {
    if (!confirm(`Remove ${contact.firstName} ${contact.lastName}?`)) return;
    setBusy(contact.id);
    try {
      const res = await fetch(
        `/api/crm/households/${household.id}/contacts/${contact.id}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[1.2px] text-ink-3">
          Contacts ({household.contacts.length})
        </h2>
        <button
          type="button"
          onClick={openCreate}
          className="rounded-[var(--radius-sm)] bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-on transition-colors hover:bg-accent-ink"
        >
          Add contact
        </button>
      </div>

      {household.contacts.length === 0 ? (
        <div className="rounded-[var(--radius)] border border-dashed border-hair bg-card-2 px-6 py-10 text-center">
          <p className="text-[13px] text-ink-3">No contacts yet.</p>
          <p className="mt-1 text-[12px] text-ink-3">
            Add the primary client to get started.
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {household.contacts.map((c) => {
            const displayName = `${c.firstName} ${c.lastName}`.trim();
            const preferred = c.preferredName?.trim();
            const dob = fmtDob(c.dateOfBirth);
            const addr = addressLine(c);
            return (
              <li
                key={c.id}
                className="rounded-[var(--radius)] border border-hair bg-card p-4 transition-colors hover:border-hair-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">
                        {ROLE_LABELS[c.role] ?? c.role}
                      </span>
                      <span className="text-[14px] font-medium text-ink">
                        {displayName}
                        {preferred ? (
                          <span className="ml-1 text-[13px] text-ink-3">({preferred})</span>
                        ) : null}
                      </span>
                    </div>

                    <dl className="mt-2.5 grid grid-cols-1 gap-y-1 text-[12.5px] text-ink-2 sm:grid-cols-[110px_1fr] sm:gap-x-3">
                      {dob && (
                        <>
                          <dt className="text-ink-3">DOB</dt>
                          <dd className="tabular-nums">{dob}</dd>
                        </>
                      )}
                      {c.email && (
                        <>
                          <dt className="text-ink-3">Email</dt>
                          <dd className="truncate">{c.email}</dd>
                        </>
                      )}
                      {(c.phone || c.mobile) && (
                        <>
                          <dt className="text-ink-3">Phone</dt>
                          <dd>
                            {[c.phone, c.mobile].filter(Boolean).join(" · ")}
                          </dd>
                        </>
                      )}
                      {c.ssnLast4 && (
                        <>
                          <dt className="text-ink-3">SSN</dt>
                          <dd className="font-mono tabular-nums">***-**-{c.ssnLast4}</dd>
                        </>
                      )}
                      {addr && (
                        <>
                          <dt className="text-ink-3">Address</dt>
                          <dd className="truncate">{addr}</dd>
                        </>
                      )}
                    </dl>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2.5 py-1 text-[12px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:text-ink"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(c)}
                      disabled={busy === c.id}
                      aria-label={`Delete ${displayName}`}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-ink-3 transition-colors hover:bg-crit/15 hover:text-crit disabled:opacity-50"
                    >
                      <TrashIcon width={14} height={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CrmContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        householdId={household.id}
        existingRoles={existingRoles}
        mode={editing ? "edit" : "create"}
        initialValues={editing ? toInitial(editing) : undefined}
        onSaved={() => router.refresh()}
      />
    </div>
  );
}
