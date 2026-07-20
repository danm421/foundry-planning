"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";

const STATUS_OPTIONS = [
  { value: "prospect", label: "Prospect" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "archived", label: "Archived" },
];

const FORM_ID = "crm-household-edit-form";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  initialName: string;
  initialStatus: string;
  initialNotes: string | null;
  initialNameIsCustom: boolean;
  /** Auto-name from the household's contacts; null when there's no primary. */
  derivedName: string | null;
}

export function CrmHouseholdEditForm({
  open,
  onOpenChange,
  householdId,
  initialName,
  initialStatus,
  initialNotes,
  initialNameIsCustom,
  derivedName,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // No derivable name (no primary contact) means custom is the only option —
  // `name` is NOT NULL, so there'd be nothing to fall back to.
  const mustBeCustom = derivedName == null;
  const [nameIsCustom, setNameIsCustom] = useState(initialNameIsCustom || mustBeCustom);
  const [name, setName] = useState(initialName);

  function toggleCustom(next: boolean) {
    setNameIsCustom(next);
    // Unticking hands the name back to derivation immediately, so what's shown
    // is what will be saved.
    if (!next && derivedName != null) setName(derivedName);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const status = String(data.get("status") ?? "");
    const notes = String(data.get("notes") ?? "").trim();
    try {
      const res = await fetch(`/api/crm/households/${householdId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          nameIsCustom,
          status,
          notes: notes ? notes : undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Update failed (${res.status})`,
        );
      }
      onOpenChange(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Edit household"
      size="md"
      primaryAction={{
        label: submitting ? "Saving…" : "Save changes",
        form: FORM_ID,
        loading: submitting,
      }}
    >
      <form id={FORM_ID} onSubmit={onSubmit} className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2 text-[13px] text-crit"
          >
            <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label className={fieldLabelClassName} htmlFor="edit-name">
            Household name
          </label>
          <input
            id="edit-name"
            name="name"
            required
            maxLength={200}
            readOnly={!nameIsCustom}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClassName}
            aria-describedby="edit-name-help"
          />
          <label
            htmlFor="edit-name-custom"
            className="mt-2 flex items-center gap-2 cursor-pointer"
          >
            <input
              id="edit-name-custom"
              type="checkbox"
              checked={nameIsCustom}
              disabled={mustBeCustom}
              onChange={(e) => toggleCustom(e.target.checked)}
              className="h-4 w-4 rounded border-hair bg-card-2 text-accent focus:ring-accent disabled:opacity-60"
            />
            <span className="text-[13px] font-medium text-ink-2">Use a custom name</span>
          </label>
          <p id="edit-name-help" className="mt-1 text-[12px] text-ink-4">
            {mustBeCustom
              ? "This household has no primary contact, so its name can't be generated automatically — it will be saved as a custom name."
              : nameIsCustom
                ? "Won't change when household members change."
                : "Updates automatically when household members change."}
          </p>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="edit-status">
            Status
          </label>
          <select
            id="edit-status"
            name="status"
            defaultValue={initialStatus}
            className={selectClassName}
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="edit-notes">
            Notes
          </label>
          <textarea
            id="edit-notes"
            name="notes"
            rows={4}
            maxLength={5000}
            defaultValue={initialNotes ?? ""}
            className={textareaClassName}
          />
        </div>
      </form>
    </DialogShell>
  );
}
