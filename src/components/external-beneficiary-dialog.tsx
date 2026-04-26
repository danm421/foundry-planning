"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import type { ExternalBeneficiary } from "@/components/family-view";

interface Props {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (saved: ExternalBeneficiary) => void;
}

const FORM_ID = "external-beneficiary-dialog-form";

export default function ExternalBeneficiaryDialog({
  clientId,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"charity" | "individual">("charity");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !saving;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/external-beneficiaries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          kind,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      const saved = (await res.json()) as ExternalBeneficiary;
      onSaved(saved);
      onOpenChange(false);
      setName("");
      setKind("charity");
      setNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title="Add Charity / External Beneficiary"
      size="md"
      primaryAction={{
        label: saving ? "Saving…" : "Add",
        form: FORM_ID,
        disabled: !canSave,
        loading: saving,
      }}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
        )}
        <div>
          <label htmlFor="ext-name" className={fieldLabelClassName}>
            Name <span className="text-red-500">*</span>
          </label>
          <input
            id="ext-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClassName}
            required
          />
        </div>
        <div>
          <label htmlFor="ext-kind" className={fieldLabelClassName}>Kind</label>
          <select
            id="ext-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as "charity" | "individual")}
            className={selectClassName}
          >
            <option value="charity">Charity</option>
            <option value="individual">Individual</option>
          </select>
        </div>
        <div>
          <label htmlFor="ext-notes" className={fieldLabelClassName}>Notes</label>
          <textarea
            id="ext-notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={textareaClassName}
          />
        </div>
      </form>
    </DialogShell>
  );
}
