"use client";

import { useEffect, useState } from "react";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import { AlertCircleIcon } from "@/components/icons";

export type CrmActivityKind =
  | "note"
  | "call"
  | "meeting"
  | "email"
  | "status_change"
  | "contact_change"
  | "account_change"
  | "document_uploaded"
  | "planning_link"
  | "relationship_change";

const KIND_OPTIONS: { value: CrmActivityKind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
];

const FORM_ID = "crm-activity-entry-form";

function toDatetimeLocalNow(): string {
  const now = new Date();
  const off = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - off).toISOString().slice(0, 16);
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  householdId: string;
  defaultKind: CrmActivityKind;
  onSaved: () => void;
}

export function CrmActivityEntryForm({
  open,
  onOpenChange,
  householdId,
  defaultKind,
  onSaved,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [occurredAt, setOccurredAt] = useState<string>(toDatetimeLocalNow());

  // Refresh the default "now" each time the dialog opens.
  useEffect(() => {
    if (open) {
      setOccurredAt(toDatetimeLocalNow());
      setError(null);
    }
  }, [open]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const kind = data.get("kind") as CrmActivityKind;
    const title = String(data.get("title") ?? "").trim();
    const body = String(data.get("body") ?? "").trim();
    const occurredAtRaw = String(data.get("occurredAt") ?? "").trim();

    const occurredIso = occurredAtRaw
      ? new Date(occurredAtRaw).toISOString()
      : new Date().toISOString();

    try {
      const res = await fetch(`/api/crm/households/${householdId}/activity`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          title,
          body: body ? body : undefined,
          occurredAt: occurredIso,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(
          typeof j.error === "string" ? j.error : `Save failed (${res.status})`,
        );
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Log activity"
      size="md"
      primaryAction={{
        label: submitting ? "Saving…" : "Save",
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

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={fieldLabelClassName} htmlFor="ae-kind">
              Type
            </label>
            <select
              id="ae-kind"
              name="kind"
              defaultValue={defaultKind}
              className={selectClassName}
            >
              {KIND_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={fieldLabelClassName} htmlFor="ae-when">
              When
            </label>
            <input
              id="ae-when"
              name="occurredAt"
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className={inputClassName}
            />
          </div>
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="ae-title">
            Title <span className="text-crit">*</span>
          </label>
          <input
            id="ae-title"
            name="title"
            required
            maxLength={300}
            placeholder="Short summary"
            className={inputClassName}
          />
        </div>

        <div>
          <label className={fieldLabelClassName} htmlFor="ae-body">
            Details
          </label>
          <textarea
            id="ae-body"
            name="body"
            rows={5}
            maxLength={20000}
            placeholder="Optional details"
            className={textareaClassName}
          />
        </div>
      </form>
    </DialogShell>
  );
}
