"use client";

import { useId, useState, type FormEvent, type ReactElement } from "react";
import DialogShell from "@/components/dialog-shell";
import { DialogTextField } from "@/components/portal/dialog-field";
import { usePortalFetch } from "@/components/portal/portal-mode-context";

export type ContactRole = "primary" | "spouse";

export const ROLE_LABEL: Record<ContactRole, string> = {
  primary: "Primary",
  spouse: "Spouse",
};

export type PortalContact = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * The four fields `PUT /api/portal/household` accepts per role, and whether the
 * column behind each one is nullable (src/db/schema.ts `crmHouseholdContacts`:
 * first_name and last_name are NOT NULL, email and phone are not). One map
 * rather than a field list plus a separate nullable set — those drift, and a
 * field missing from the second one silently writes `""` instead of NULL.
 */
const FIELDS = {
  firstName: { label: "First name", type: "text", nullable: false },
  lastName: { label: "Last name", type: "text", nullable: false },
  email: { label: "Email", type: "email", nullable: true },
  phone: { label: "Phone", type: "tel", nullable: true },
} as const;

type EditableKey = keyof typeof FIELDS;
const KEYS = Object.keys(FIELDS) as EditableKey[];

const FORM_ID = "portal-household-contact-form";

/**
 * Edit dialog behind the Household → primary/spouse cards.
 *
 * Sends only the role being edited (`{ primary }` or `{ spouse }`) and only the
 * fields that actually changed — the route audits per-field before/after, so a
 * full-object PUT would log untouched fields as "changed" on every save.
 */
export default function HouseholdContactDialog({
  role,
  contact,
  onClose,
  onSaved,
}: {
  role: ContactRole;
  contact: PortalContact;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const portalFetch = usePortalFetch();
  const [draft, setDraft] = useState<PortalContact>(contact);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  const patch = buildPatch(draft, contact);
  const dirty = Object.keys(patch).length > 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!dirty || saving) return;
    if (!draft.firstName.trim()) {
      setError("First name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await portalFetch("/api/portal/household", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [role]: patch }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(body?.error ?? "Could not save your changes.");
        return;
      }
      onSaved();
    } catch {
      setError("Could not save your changes.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={`Edit ${ROLE_LABEL[role].toLowerCase()}`}
      size="sm"
      primaryAction={{
        label: "Save",
        form: FORM_ID,
        disabled: !dirty,
        loading: saving,
      }}
    >
      <form id={FORM_ID} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        {KEYS.map((key, i) => (
          <DialogTextField
            key={key}
            id={`${ids}-${key}`}
            label={FIELDS[key].label}
            type={FIELDS[key].type}
            value={draft[key] ?? ""}
            onChange={(v) => setDraft((d) => ({ ...d, [key]: v }))}
            autoFocus={i === 0}
          />
        ))}
        {error && (
          <p role="alert" className="text-[12px] text-crit sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </DialogShell>
  );
}

/** Trimmed diff vs the server copy — the route audits per field, so unchanged
 *  ones must not be in the patch. A cleared nullable field is sent as `null` so
 *  the column ends up NULL rather than an empty string; a cleared NOT NULL one
 *  is sent as `""`, because `null` there would 500 on the constraint. */
function buildPatch(
  draft: PortalContact,
  original: PortalContact,
): Partial<Record<EditableKey, string | null>> {
  const patch: Partial<Record<EditableKey, string | null>> = {};
  for (const key of KEYS) {
    const next = (draft[key] ?? "").trim();
    const prev = (original[key] ?? "").trim();
    if (next === prev) continue;
    patch[key] = next === "" && FIELDS[key].nullable ? null : next;
  }
  return patch;
}
