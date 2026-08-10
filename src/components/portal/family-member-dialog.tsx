"use client";

import { useId, useState, type FormEvent, type ReactElement } from "react";
import DialogShell from "@/components/dialog-shell";
import { selectClassName } from "@/components/forms/input-styles";
import {
  DialogField,
  DialogTextField,
} from "@/components/portal/dialog-field";
import { usePortalFetch } from "@/components/portal/portal-mode-context";
import { FAMILY_RELATIONSHIP_OPTIONS } from "@/lib/family-relationships";

export type PortalFamilyMember = {
  id: string;
  firstName: string;
  lastName: string | null;
  relationship: string;
  dateOfBirth: string | null;
};

const FORM_ID = "portal-family-member-form";

type Draft = Omit<PortalFamilyMember, "id">;

const EMPTY: Draft = {
  firstName: "",
  lastName: "",
  relationship: "child",
  dateOfBirth: null,
};

/**
 * Add/edit dialog behind the Household → Family cards.
 *
 * `member` absent = create (POST /api/portal/family); present = edit
 * (PUT /api/portal/family/:id) with delete available.
 *
 * Delete is a two-step press inside this dialog rather than `window.confirm`:
 * the shell already owns the focus trap and scroll lock, and a native confirm
 * escapes both (and is unstyleable, so it reads as a browser alert on a
 * client-facing screen).
 */
export default function FamilyMemberDialog({
  member,
  onClose,
  onSaved,
}: {
  member?: PortalFamilyMember;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const portalFetch = usePortalFetch();
  const [draft, setDraft] = useState<Draft>(member ? toDraft(member) : EMPTY);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const firstName = draft.firstName.trim();
    if (!firstName) {
      setError("First name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        firstName,
        lastName: draft.lastName?.trim() ? draft.lastName.trim() : null,
        relationship: draft.relationship,
        dateOfBirth: draft.dateOfBirth || null,
      };
      const res = await portalFetch(
        member ? `/api/portal/family/${member.id}` : "/api/portal/family",
        {
          method: member ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "Could not save this person.");
        return;
      }
      onSaved();
    } catch {
      setError("Could not save this person.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!member || busy) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await portalFetch(`/api/portal/family/${member.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("Could not remove this person.");
        setConfirmingDelete(false);
        return;
      }
      onSaved();
    } catch {
      setError("Could not remove this person.");
      setConfirmingDelete(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={member ? "Edit person" : "Add person"}
      size="sm"
      primaryAction={{
        label: member ? "Save" : "Add",
        form: FORM_ID,
        disabled: busy,
        loading: busy && !confirmingDelete,
      }}
      destructiveAction={
        member
          ? {
              label: confirmingDelete ? "Confirm remove" : "Remove",
              onClick: () => void remove(),
              disabled: busy,
            }
          : undefined
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <DialogTextField
          id={`${ids}-first`}
          label="First name"
          value={draft.firstName}
          onChange={(v) => set("firstName", v)}
          autoFocus
        />
        <DialogTextField
          id={`${ids}-last`}
          label="Last name"
          value={draft.lastName ?? ""}
          onChange={(v) => set("lastName", v)}
        />
        <DialogField id={`${ids}-rel`} label="Relationship">
          <select
            id={`${ids}-rel`}
            value={draft.relationship}
            onChange={(e) => set("relationship", e.target.value)}
            className={selectClassName}
          >
            {FAMILY_RELATIONSHIP_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </DialogField>
        <DialogTextField
          id={`${ids}-dob`}
          label="Date of birth"
          type="date"
          value={draft.dateOfBirth ?? ""}
          onChange={(v) => set("dateOfBirth", v || null)}
        />
        {confirmingDelete && (
          <p className="text-[12px] text-crit sm:col-span-2">
            Press Confirm remove to take {draft.firstName || "this person"} off
            your plan. This cannot be undone.
          </p>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-crit sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    </DialogShell>
  );
}

function toDraft(m: PortalFamilyMember): Draft {
  return {
    firstName: m.firstName,
    lastName: m.lastName,
    relationship: m.relationship,
    dateOfBirth: m.dateOfBirth,
  };
}
