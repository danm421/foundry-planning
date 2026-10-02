"use client";

import { useState } from "react";
import { useScenarioWriter, type UseScenarioWriter } from "@/hooks/use-scenario-writer";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import type { ExternalBeneficiary } from "@/components/family-view";

export type ExternalBeneficiaryBody = {
  name: string;
  kind: "charity" | "individual";
  notes: string | null;
};

/**
 * The one save path for an external beneficiary: this dialog and the Family
 * page's inline row form both call it. Inside a scenario the write is a scenario
 * change (a new charity is modelled as a public one, the schema default), with
 * no call to the base routes; otherwise it is the base REST call. Resolves to
 * the saved row and throws the response's error message on failure.
 */
export async function saveExternalBeneficiary(
  writer: UseScenarioWriter,
  clientId: string,
  existing: ExternalBeneficiary | undefined,
  body: ExternalBeneficiaryBody,
): Promise<ExternalBeneficiary> {
  const newId = existing ? null : crypto.randomUUID();
  const res = existing
    ? await writer.submit(
        { op: "edit", targetKind: "external_beneficiary", targetId: existing.id, desiredFields: body },
        { url: `/api/clients/${clientId}/external-beneficiaries/${existing.id}`, method: "PATCH", body },
      )
    : await writer.submit(
        { op: "add", targetKind: "external_beneficiary", entity: { id: newId, ...body, charityType: "public" } },
        { url: `/api/clients/${clientId}/external-beneficiaries`, method: "POST", body },
      );
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? `HTTP ${res.status}`);
  }
  // In scenario mode /changes returns { ok, targetId }, not a full row;
  // synthesize the saved beneficiary from the ids and body in hand.
  if (writer.scenarioActive) return { id: existing?.id ?? newId!, ...body };
  return (await res.json()) as ExternalBeneficiary;
}

/** The delete both the Family page and focus mode's delete intent run. */
export function removeExternalBeneficiary(
  writer: UseScenarioWriter,
  clientId: string,
  id: string,
): Promise<Response> {
  return writer.submit(
    { op: "remove", targetKind: "external_beneficiary", targetId: id },
    { url: `/api/clients/${clientId}/external-beneficiaries/${id}`, method: "DELETE" },
  );
}

interface Props {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Set to edit that row; absent adds a new one. */
  editing?: ExternalBeneficiary;
  onSaved: (saved: ExternalBeneficiary) => void;
}

const FORM_ID = "external-beneficiary-dialog-form";

export default function ExternalBeneficiaryDialog({
  clientId,
  open,
  onOpenChange,
  editing,
  onSaved,
}: Props) {
  const writer = useScenarioWriter(clientId);
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<"charity" | "individual">(editing?.kind ?? "charity");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSave = name.trim().length > 0 && !saving;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await saveExternalBeneficiary(writer, clientId, editing, {
        name: name.trim(),
        kind,
        notes: notes.trim() || null,
      });
      onSaved(saved);
      onOpenChange(false);
      if (!editing) {
        setName("");
        setKind("charity");
        setNotes("");
      }
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
      title={editing ? "Edit Charity / External Beneficiary" : "Add Charity / External Beneficiary"}
      size="md"
      primaryAction={{
        label: saving ? "Saving…" : editing ? "Save Changes" : "Add",
        form: FORM_ID,
        disabled: !canSave,
        loading: saving,
      }}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="rounded bg-crit/10 px-3 py-2 text-sm text-crit">{error}</p>
        )}
        <div>
          <label htmlFor="ext-name" className={fieldLabelClassName}>
            Name <span className="text-crit">*</span>
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
