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
}

export function CrmHouseholdEditForm({
  open,
  onOpenChange,
  householdId,
  initialName,
  initialStatus,
  initialNotes,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const status = String(data.get("status") ?? "");
    const notes = String(data.get("notes") ?? "").trim();
    try {
      const res = await fetch(`/api/crm/households/${householdId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
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
            defaultValue={initialName}
            className={inputClassName}
          />
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
