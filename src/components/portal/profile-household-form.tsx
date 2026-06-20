"use client";

import { useState, type ReactElement } from "react";
import { useRouter } from "next/navigation";

type Contact = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
} | null;

interface Props {
  primary: Contact;
  spouse: Contact;
  editEnabled: boolean;
}

export default function ProfileHouseholdForm({
  primary,
  spouse,
  editEnabled,
}: Props): ReactElement {
  const router = useRouter();
  const [draftPrimary, setDraftPrimary] = useState(primary);
  const [draftSpouse, setDraftSpouse] = useState(spouse);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    JSON.stringify(draftPrimary) !== JSON.stringify(primary) ||
    JSON.stringify(draftSpouse) !== JSON.stringify(spouse);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/portal/household", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          primary: draftPrimary && primary ? pick(draftPrimary, primary) : undefined,
          spouse: draftSpouse && spouse ? pick(draftSpouse, spouse) : undefined,
        }),
      });
      if (!res.ok) {
        setError((await res.json().catch(() => ({ error: "Failed to save" }))).error);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {draftPrimary && (
        <ContactCard
          title="Primary"
          contact={draftPrimary}
          onChange={setDraftPrimary}
          readOnly={!editEnabled}
        />
      )}
      {draftSpouse && (
        <ContactCard
          title="Spouse"
          contact={draftSpouse}
          onChange={setDraftSpouse}
          readOnly={!editEnabled}
        />
      )}
      {error && <p className="text-[12px] text-bad">{error}</p>}
      {editEnabled && dirty && (
        <footer className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={() => {
              setDraftPrimary(primary);
              setDraftSpouse(spouse);
            }}
            className="rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md border border-accent bg-accent/15 px-3 py-1.5 text-[13px] font-medium text-accent disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </footer>
      )}
    </div>
  );
}

type NonNullContact = NonNullable<Contact>;

function pick(
  next: NonNullContact,
  original: NonNullContact,
): Partial<NonNullContact> {
  const diff: Partial<NonNullContact> = {};
  (["firstName", "lastName", "email", "phone"] as const).forEach((k) => {
    if (next[k] !== original[k]) diff[k] = next[k] as never;
  });
  return diff;
}

function ContactCard({
  title,
  contact,
  onChange,
  readOnly,
}: {
  title: string;
  contact: NonNullContact;
  onChange: (c: NonNullContact) => void;
  readOnly: boolean;
}): ReactElement {
  function set<K extends keyof NonNullContact>(
    key: K,
    value: NonNullContact[K],
  ) {
    onChange({ ...contact, [key]: value });
  }
  return (
    <section className="rounded-md border border-hair bg-paper p-4">
      <h3 className="text-[14px] font-medium text-ink mb-3">{title}</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name" value={contact.firstName} onChange={(v) => set("firstName", v)} readOnly={readOnly} />
        <Field label="Last name" value={contact.lastName ?? ""} onChange={(v) => set("lastName", v)} readOnly={readOnly} />
        <Field label="Email" value={contact.email ?? ""} onChange={(v) => set("email", v)} readOnly={readOnly} />
        <Field label="Phone" value={contact.phone ?? ""} onChange={(v) => set("phone", v)} readOnly={readOnly} />
      </div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly: boolean;
}): ReactElement {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-wide text-ink-3 mb-1">
        {label}
      </span>
      {readOnly ? (
        <div className="text-[13px] text-ink">{value || "—"}</div>
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-hair bg-card-2 px-3 py-1.5 text-[13px] text-ink"
        />
      )}
    </label>
  );
}
