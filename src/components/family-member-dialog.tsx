"use client";

import { useState } from "react";
import { useScenarioWriter } from "@/hooks/use-scenario-writer";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  textareaClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import type { FamilyMember } from "@/components/family-view";

const RELATIONSHIP_OPTIONS = [
  { value: "child", label: "Child" },
  { value: "grandchild", label: "Grandchild" },
  { value: "parent", label: "Parent" },
  { value: "sibling", label: "Sibling" },
  { value: "other", label: "Other" },
] as const;

interface Props {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: FamilyMember;
  onSaved: (member: FamilyMember, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
}

const FORM_ID = "family-member-dialog-form";

export default function FamilyMemberDialog({
  clientId,
  open,
  onOpenChange,
  editing,
  onSaved,
  onRequestDelete,
}: Props) {
  const isEdit = Boolean(editing);
  const writer = useScenarioWriter(clientId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const data = new FormData(e.currentTarget);
    const body = {
      firstName: data.get("firstName") as string,
      lastName: data.get("lastName") as string,
      relationship: data.get("relationship") as string,
      dateOfBirth: (data.get("dateOfBirth") as string) || null,
      notes: (data.get("notes") as string) || null,
    };
    try {
      const newMemberId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `tmp-${Date.now()}`;

      const res = isEdit
        ? await writer.submit(
            {
              op: "edit",
              targetKind: "family_member",
              targetId: editing!.id,
              desiredFields: body,
            },
            {
              url: `/api/clients/${clientId}/family-members/${editing!.id}`,
              method: "PUT",
              body,
            },
          )
        : await writer.submit(
            {
              op: "add",
              targetKind: "family_member",
              entity: { id: newMemberId, ...body },
            },
            {
              url: `/api/clients/${clientId}/family-members`,
              method: "POST",
              body,
            },
          );
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Failed to save");
      }
      // Base mode returns the saved row; scenario mode returns { ok, targetId }.
      // Synthesize a FamilyMember in scenario mode — router.refresh() (run by
      // the writer) reloads canonical state shortly after.
      const saved: FamilyMember = writer.scenarioActive
        ? {
            id: isEdit ? editing!.id : newMemberId,
            firstName: body.firstName,
            lastName: body.lastName || null,
            relationship: body.relationship as FamilyMember["relationship"],
            dateOfBirth: body.dateOfBirth,
            notes: body.notes,
          }
        : ((await res.json()) as FamilyMember);
      onSaved(saved, isEdit ? "edit" : "create");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit Family Member" : "Add Family Member"}
      size="md"
      primaryAction={{
        label: loading ? "Saving…" : isEdit ? "Save Changes" : "Add",
        form: FORM_ID,
        loading,
      }}
      destructiveAction={
        isEdit && onRequestDelete
          ? { label: "Delete…", onClick: onRequestDelete }
          : undefined
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">{error}</p>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="fm-first" className={fieldLabelClassName}>
              First Name <span className="text-red-500">*</span>
            </label>
            <input
              id="fm-first"
              name="firstName"
              type="text"
              required
              defaultValue={editing?.firstName ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label htmlFor="fm-last" className={fieldLabelClassName}>Last Name</label>
            <input
              id="fm-last"
              name="lastName"
              type="text"
              defaultValue={editing?.lastName ?? ""}
              className={inputClassName}
            />
          </div>
          <div>
            <label htmlFor="fm-rel" className={fieldLabelClassName}>Relationship</label>
            <select
              id="fm-rel"
              name="relationship"
              defaultValue={editing?.relationship ?? "child"}
              className={selectClassName}
            >
              {RELATIONSHIP_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fm-dob" className={fieldLabelClassName}>Date of Birth</label>
            <input
              id="fm-dob"
              name="dateOfBirth"
              type="date"
              defaultValue={
                editing?.dateOfBirth ? String(editing.dateOfBirth).slice(0, 10) : ""
              }
              className={inputClassName}
            />
          </div>
        </div>

        <div>
          <label htmlFor="fm-notes" className={fieldLabelClassName}>Notes</label>
          <textarea
            id="fm-notes"
            name="notes"
            rows={2}
            defaultValue={editing?.notes ?? ""}
            className={textareaClassName}
          />
        </div>
      </form>
    </DialogShell>
  );
}
