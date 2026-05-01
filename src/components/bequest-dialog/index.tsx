"use client";

import { useState } from "react";
import DialogShell from "@/components/dialog-shell";
import {
  inputClassName,
  selectClassName,
  fieldLabelClassName,
} from "@/components/forms/input-styles";
import BequestRecipientList from "@/components/forms/bequest-recipient-list";
import type {
  WillCondition,
  WillsPanelAccount,
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
  WillsPanelPrimary,
  WillRecipientKind,
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
  primary: WillsPanelPrimary;
  accounts: WillsPanelAccount[];
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  editing?: BequestDraft;
  saving?: boolean;
  onSave: (draft: BequestDraft) => void;
}

const FORM_ID = "bequest-dialog-form";

const emptyDraft = (hasSpouse: boolean): BequestDraft => ({
  name: "",
  assetMode: "specific",
  accountId: null,
  percentage: 100,
  condition: "always",
  sortOrder: 0,
  recipients: [
    {
      recipientKind: hasSpouse ? "spouse" : "family_member",
      recipientId: null,
      percentage: 100,
      sortOrder: 0,
    },
  ],
});

const CONDITION_OPTIONS: ReadonlyArray<{ value: WillCondition; label: string }> = [
  { value: "always", label: "Always" },
  { value: "if_spouse_survives", label: "If spouse survives" },
  { value: "if_spouse_predeceased", label: "If spouse predeceases" },
];

function deriveBequestName(draft: BequestDraft, accounts: WillsPanelAccount[]): string {
  if (draft.assetMode === "all_assets") return "Remaining Estate Value";
  const acct = accounts.find((a) => a.id === draft.accountId);
  return acct?.name?.trim() || "Asset bequest";
}

export default function BequestDialog({
  open,
  onOpenChange,
  primary,
  accounts,
  familyMembers,
  externalBeneficiaries,
  entities,
  editing,
  saving = false,
  onSave,
}: BequestDialogProps) {
  const hasSpouse = primary.spouseName != null;
  const [draft, setDraft] = useState<BequestDraft>(editing ?? emptyDraft(hasSpouse));
  // Re-sync draft when the dialog opens or the editing target changes between opens.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevEditing, setPrevEditing] = useState(editing);
  if (open !== prevOpen || editing !== prevEditing) {
    setPrevOpen(open);
    setPrevEditing(editing);
    if (open) {
      setDraft(editing ?? emptyDraft(hasSpouse));
    }
  }

  const recipientSum = draft.recipients.reduce((s, x) => s + x.percentage, 0);
  const recipientSumOk = Math.abs(recipientSum - 100) < 0.01;
  const accountIdOk = draft.assetMode === "specific" ? draft.accountId != null : true;
  const recipientsHaveIds = draft.recipients.every(
    (r) => r.recipientKind === "spouse" || r.recipientId != null,
  );
  const canSave = recipientSumOk && accountIdOk && recipientsHaveIds && !saving;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    onSave({ ...draft, name: deriveBequestName(draft, accounts) });
  }

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit bequest" : "New bequest"}
      size="md"
      primaryAction={{
        label: saving ? "Saving…" : "Save",
        form: FORM_ID,
        disabled: !canSave,
        loading: saving,
      }}
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2">
            <label className={fieldLabelClassName}>Asset</label>
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
              <option value="__residual__">Remaining Estate Value</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className={fieldLabelClassName}>Percentage</label>
            <input
              type="number"
              aria-label="Percentage"
              min={0.01}
              max={100}
              step={0.01}
              value={draft.percentage}
              onChange={(e) => setDraft({ ...draft, percentage: parseFloat(e.target.value) || 0 })}
              className={inputClassName}
            />
          </div>
        </div>

        {hasSpouse && (
          <div>
            <label className={fieldLabelClassName}>Condition</label>
            <div className="flex gap-1">
              {CONDITION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDraft({ ...draft, condition: opt.value })}
                  className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                    draft.condition === opt.value
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-hair bg-card-2 text-ink-2 hover:bg-card-hover"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <BequestRecipientList
          mode="asset"
          rows={draft.recipients}
          onChange={(recipients) => setDraft({ ...draft, recipients })}
          primary={primary}
          familyMembers={familyMembers}
          externalBeneficiaries={externalBeneficiaries}
          entities={entities}
        />
      </form>
    </DialogShell>
  );
}
