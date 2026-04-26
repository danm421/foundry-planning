"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import type {
  WillCondition,
  WillRecipientKind,
  WillsPanelAccount,
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
} from "@/components/wills-panel";

export interface BequestDraft {
  name: string;
  assetMode: "specific" | "all_assets";
  accountId: string | null;
  percentage: number;
  condition: WillCondition;
  sortOrder: number;
  recipients: Array<{
    recipientKind: WillRecipientKind;
    recipientId: string | null;
    percentage: number;
    sortOrder: number;
  }>;
}

interface BequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: WillsPanelAccount[];
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  editing?: BequestDraft;
  saving?: boolean;
  onSave: (draft: BequestDraft) => void;
}

const FORM_ID = "bequest-dialog-form";

const emptyDraft = (): BequestDraft => ({
  name: "",
  assetMode: "specific",
  accountId: null,
  percentage: 100,
  condition: "always",
  sortOrder: 0,
  recipients: [
    {
      recipientKind: "spouse",
      recipientId: null,
      percentage: 100,
      sortOrder: 0,
    },
  ],
});

export default function BequestDialog({
  open,
  onOpenChange,
  accounts,
  familyMembers,
  externalBeneficiaries,
  entities,
  editing,
  saving = false,
  onSave,
}: BequestDialogProps) {
  const [draft, setDraft] = useState<BequestDraft>(editing ?? emptyDraft());
  // Re-sync draft from `editing` when the dialog opens or the editing target changes
  // between opens. Tracked-prev pattern (per React docs: "Adjusting some state when a
  // prop changes") so callers that keep BequestDialog mounted across opens still get
  // fresh draft state.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevEditing, setPrevEditing] = useState(editing);
  if (open !== prevOpen || editing !== prevEditing) {
    setPrevOpen(open);
    setPrevEditing(editing);
    if (open) {
      setDraft(editing ?? emptyDraft());
    }
  }

  const recipientSum = draft.recipients.reduce((s, x) => s + x.percentage, 0);
  const recipientSumOk = Math.abs(recipientSum - 100) < 0.01;
  const accountIdOk = draft.assetMode === "specific" ? draft.accountId != null : true;
  const canSave = draft.name.trim().length > 0 && recipientSumOk && accountIdOk && !saving;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    onSave(draft);
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit bequest" : "New bequest"}
      size="md"
      primaryAction={{ label: saving ? "Saving…" : "Save", form: FORM_ID, disabled: !canSave, loading: saving }}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <label className="block text-sm">
          <span className={fieldLabelClassName}>Name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className={inputClassName}
          />
        </label>

        <label className="block text-sm">
          <span className={fieldLabelClassName}>Asset</span>
          <select
            aria-label="Asset"
            value={draft.assetMode === "all_assets" ? "__residual__" : (draft.accountId ?? "")}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "__residual__") {
                setDraft({ ...draft, assetMode: "all_assets", accountId: null });
              } else {
                setDraft({ ...draft, assetMode: "specific", accountId: v });
              }
            }}
            className={selectClassName}
          >
            <option value="__residual__">All other assets</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className={fieldLabelClassName}>Percentage</span>
          <input
            type="number"
            min={0.01}
            max={100}
            step={0.01}
            value={draft.percentage}
            onChange={(e) => setDraft({ ...draft, percentage: parseFloat(e.target.value) || 0 })}
            className={inputClassName}
          />
        </label>

        <label className="block text-sm">
          <span className={fieldLabelClassName}>Condition</span>
          <select
            value={draft.condition}
            onChange={(e) => setDraft({ ...draft, condition: e.target.value as WillCondition })}
            className={selectClassName}
          >
            <option value="always">Always</option>
            <option value="if_spouse_survives">If spouse survives</option>
            <option value="if_spouse_predeceased">If spouse predeceases</option>
          </select>
        </label>

        <fieldset>
          <legend className="mb-2 text-sm text-ink-2">Recipients</legend>
          {draft.recipients.map((r, i) => (
            <div key={i} className="mb-2 flex items-center gap-2">
              <select
                aria-label="Recipient kind"
                value={r.recipientKind}
                onChange={(e) => {
                  const nextKind = e.target.value as WillRecipientKind;
                  const next = [...draft.recipients];
                  next[i] = {
                    ...r,
                    recipientKind: nextKind,
                    recipientId:
                      nextKind === "spouse" ? null :
                      nextKind === "family_member" ? familyMembers[0]?.id ?? null :
                      nextKind === "external_beneficiary" ? externalBeneficiaries[0]?.id ?? null :
                      entities[0]?.id ?? null,
                  };
                  setDraft({ ...draft, recipients: next });
                }}
                className={selectClassName}
              >
                <option value="spouse">Spouse</option>
                <option value="family_member">Family member</option>
                <option value="external_beneficiary">External beneficiary</option>
                <option value="entity">Entity / Trust</option>
              </select>
              {r.recipientKind !== "spouse" && (
                <select
                  aria-label="Recipient name"
                  value={r.recipientId ?? ""}
                  onChange={(e) => {
                    const next = [...draft.recipients];
                    next[i] = { ...r, recipientId: e.target.value };
                    setDraft({ ...draft, recipients: next });
                  }}
                  className={`${selectClassName} flex-1`}
                >
                  {r.recipientKind === "family_member" &&
                    familyMembers.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.firstName} {f.lastName ?? ""}
                      </option>
                    ))}
                  {r.recipientKind === "external_beneficiary" &&
                    externalBeneficiaries.map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                  {r.recipientKind === "entity" &&
                    entities.map((x) => (
                      <option key={x.id} value={x.id}>{x.name}</option>
                    ))}
                </select>
              )}
              <input
                type="number"
                aria-label="Recipient percentage"
                min={0.01}
                max={100}
                step={0.01}
                value={r.percentage}
                onChange={(e) => {
                  const next = [...draft.recipients];
                  next[i] = { ...r, percentage: parseFloat(e.target.value) || 0 };
                  setDraft({ ...draft, recipients: next });
                }}
                className={`${inputClassName} w-20`}
              />
              <button
                type="button"
                onClick={() => setDraft({ ...draft, recipients: draft.recipients.filter((_, j) => j !== i) })}
                className="rounded-md border border-hair-2 px-2 py-1 text-sm text-ink-3 hover:bg-card-hover"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              const sortOrder = draft.recipients.length;
              setDraft({
                ...draft,
                recipients: [
                  ...draft.recipients,
                  {
                    recipientKind: "family_member",
                    recipientId: familyMembers[0]?.id ?? null,
                    percentage: 0,
                    sortOrder,
                  },
                ],
              });
            }}
            className="rounded-md border border-hair-2 bg-card-2 px-2 py-1 text-xs text-ink hover:bg-card-hover"
          >
            + Add recipient
          </button>
          <p className="mt-2 text-xs text-ink-3">
            Total:{" "}
            <span className={recipientSumOk ? "text-emerald-400" : "text-red-400"}>
              {recipientSum.toFixed(2)}%
            </span>
          </p>
        </fieldset>
      </form>
    </DialogShell>
  );
}
