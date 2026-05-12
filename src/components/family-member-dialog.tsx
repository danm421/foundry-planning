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
  { value: "stepchild", label: "Stepchild" },
  { value: "grandchild", label: "Grandchild" },
  { value: "great_grandchild", label: "Great-grandchild" },
  { value: "parent", label: "Parent" },
  { value: "grandparent", label: "Grandparent" },
  { value: "sibling", label: "Sibling" },
  { value: "sibling_in_law", label: "Sibling-in-law" },
  { value: "child_in_law", label: "Son/Daughter-in-law" },
  { value: "niece_nephew", label: "Niece/Nephew" },
  { value: "aunt_uncle", label: "Aunt/Uncle" },
  { value: "cousin", label: "Cousin" },
  { value: "grand_aunt_uncle", label: "Grand-aunt/uncle" },
  { value: "other", label: "Other" },
] as const;

const INHERITANCE_STATES = ["PA", "NJ", "KY", "NE", "MD"] as const;
type InheritanceState = (typeof INHERITANCE_STATES)[number];
type ClassLetter = "A" | "B" | "C" | "D";

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

    const inheritanceClassOverride: Partial<Record<InheritanceState, ClassLetter>> = {};
    for (const s of INHERITANCE_STATES) {
      const v = (data.get(`inheritanceClassOverride.${s}`) as string) || "";
      if (v === "A" || v === "B" || v === "C" || v === "D") {
        inheritanceClassOverride[s] = v;
      }
    }

    const body = {
      firstName: data.get("firstName") as string,
      lastName: data.get("lastName") as string,
      relationship: data.get("relationship") as string,
      dateOfBirth: (data.get("dateOfBirth") as string) || null,
      notes: (data.get("notes") as string) || null,
      domesticPartner: data.get("domesticPartner") === "on",
      inheritanceClassOverride,
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
      const saved: FamilyMember = writer.scenarioActive
        ? {
            id: isEdit ? editing!.id : newMemberId,
            firstName: body.firstName,
            lastName: body.lastName || null,
            relationship: body.relationship as FamilyMember["relationship"],
            dateOfBirth: body.dateOfBirth,
            notes: body.notes,
            domesticPartner: body.domesticPartner,
            inheritanceClassOverride: body.inheritanceClassOverride,
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

  const existingOverrides = editing?.inheritanceClassOverride ?? {};

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

        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            name="domesticPartner"
            defaultChecked={editing?.domesticPartner ?? false}
            className="h-4 w-4 rounded border-gray-700 bg-gray-800 text-blue-500 focus:ring-blue-500"
          />
          Domestic partner (affects NJ/MD inheritance tax)
        </label>

        <details className="rounded border border-gray-700 bg-gray-800/50 p-3">
          <summary className="cursor-pointer select-none text-sm text-gray-300 hover:text-gray-100">
            Inheritance tax class overrides
          </summary>
          <div className="mt-3 space-y-2">
            <p className="text-xs text-gray-400">
              Use these only if the auto-classification (based on the relationship dropdown above) is wrong for a specific state.
            </p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {INHERITANCE_STATES.map((state) => (
                <div key={state} className="flex items-center gap-2">
                  <label htmlFor={`fm-override-${state}`} className="w-10 text-xs font-medium text-gray-400">
                    {state}
                  </label>
                  <select
                    id={`fm-override-${state}`}
                    name={`inheritanceClassOverride.${state}`}
                    defaultValue={existingOverrides[state] ?? ""}
                    className={selectClassName}
                  >
                    <option value="">Auto</option>
                    <option value="A">Class A</option>
                    <option value="B">Class B</option>
                    <option value="C">Class C</option>
                    <option value="D">Class D</option>
                  </select>
                </div>
              ))}
            </div>
          </div>
        </details>

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
