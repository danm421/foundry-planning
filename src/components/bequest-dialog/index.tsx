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
  WillsPanelLiability,
  WillsPanelPrimary,
  WillRecipientKind,
} from "@/components/wills-panel";

interface BequestRecipientDraft {
  recipientKind: WillRecipientKind;
  recipientId: string | null;
  percentage: number;
  sortOrder: number;
}

export interface AssetBequestDraft {
  kind: "asset";
  name: string;
  assetMode: "specific" | "all_assets";
  accountId: string | null;
  percentage: number;
  condition: WillCondition;
  sortOrder: number;
  recipients: BequestRecipientDraft[];
}

export interface LiabilityBequestDraft {
  kind: "liability";
  name: string;
  liabilityId: string | null;
  percentage: number;
  condition: "always";
  sortOrder: number;
  recipients: BequestRecipientDraft[];
}

export type BequestDraft = AssetBequestDraft | LiabilityBequestDraft;

interface BequestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primary: WillsPanelPrimary;
  accounts: WillsPanelAccount[];
  liabilities?: WillsPanelLiability[];
  /** Liability ids already used by other bequests on this will — disabled in the picker. */
  alreadyBequeathedLiabilityIds?: string[];
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  editing?: BequestDraft;
  saving?: boolean;
  onSave: (draft: BequestDraft) => void;
}

const FORM_ID = "bequest-dialog-form";

const emptyAssetDraft = (hasSpouse: boolean): AssetBequestDraft => ({
  kind: "asset",
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

const RESIDUAL_VALUE = "__residual__";
const ASSET_PREFIX = "asset:";
const DEBT_PREFIX = "debt:";

function selectorValue(draft: BequestDraft): string {
  if (draft.kind === "liability") {
    return draft.liabilityId ? `${DEBT_PREFIX}${draft.liabilityId}` : "";
  }
  if (draft.assetMode === "all_assets") return RESIDUAL_VALUE;
  return draft.accountId ? `${ASSET_PREFIX}${draft.accountId}` : "";
}

function deriveBequestName(
  draft: BequestDraft,
  accounts: WillsPanelAccount[],
  liabilities: WillsPanelLiability[],
): string {
  if (draft.kind === "liability") {
    const l = liabilities.find((x) => x.id === draft.liabilityId);
    return l?.name?.trim() || "(unnamed liability)";
  }
  if (draft.assetMode === "all_assets") return "Remaining Estate Value";
  const acct = accounts.find((a) => a.id === draft.accountId);
  return acct?.name?.trim() || "Asset bequest";
}

export default function BequestDialog({
  open,
  onOpenChange,
  primary,
  accounts,
  liabilities = [],
  alreadyBequeathedLiabilityIds = [],
  familyMembers,
  externalBeneficiaries,
  entities,
  editing,
  saving = false,
  onSave,
}: BequestDialogProps) {
  const hasSpouse = primary.spouseName != null;
  const [draft, setDraft] = useState<BequestDraft>(editing ?? emptyAssetDraft(hasSpouse));
  // Re-sync draft when the dialog opens or the editing target changes between opens.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevEditing, setPrevEditing] = useState(editing);
  if (open !== prevOpen || editing !== prevEditing) {
    setPrevOpen(open);
    setPrevEditing(editing);
    if (open) {
      setDraft(editing ?? emptyAssetDraft(hasSpouse));
    }
  }

  const eligibleLiabilities = liabilities.filter(
    (l) => l.linkedPropertyId == null && l.ownerEntityId == null,
  );

  const recipientSum = draft.recipients.reduce((s, x) => s + x.percentage, 0);
  const recipientsHaveIds = draft.recipients.every(
    (r) => r.recipientKind === "spouse" || r.recipientId != null,
  );

  // Asset: recipients must sum exactly to 100. Debt: 0 < sum ≤ 100, remainder
  // falls to estate creditor-payoff.
  const recipientSumOk =
    draft.kind === "liability"
      ? recipientSum > 0 && recipientSum <= 100.01
      : Math.abs(recipientSum - 100) < 0.01;

  const targetSelected =
    draft.kind === "liability"
      ? draft.liabilityId != null
      : draft.assetMode === "all_assets" || draft.accountId != null;

  const canSave = recipientSumOk && targetSelected && recipientsHaveIds && !saving;

  const debtRemainder =
    draft.kind === "liability"
      ? Math.round((100 - recipientSum) * 100) / 100
      : 0;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSave) return;
    onSave({ ...draft, name: deriveBequestName(draft, accounts, liabilities) });
  }

  function handleSelectorChange(value: string) {
    if (value === RESIDUAL_VALUE) {
      setDraft({
        kind: "asset",
        name: "",
        assetMode: "all_assets",
        accountId: null,
        percentage: 100,
        condition: "always",
        sortOrder: draft.sortOrder,
        recipients: draft.recipients,
      });
      return;
    }
    if (value.startsWith(ASSET_PREFIX)) {
      const id = value.slice(ASSET_PREFIX.length);
      // Coming from a debt selection, seed asset-mode defaults for percentage,
      // condition, and recipients (debt-mode recipients can include kinds the
      // asset recipient list doesn't render; the spouse default is fine here).
      const fromDebt = draft.kind === "liability";
      setDraft({
        kind: "asset",
        name: "",
        assetMode: "specific",
        accountId: id,
        percentage: fromDebt ? 100 : draft.kind === "asset" ? draft.percentage : 100,
        condition: fromDebt
          ? "always"
          : draft.kind === "asset"
            ? draft.condition
            : "always",
        sortOrder: draft.sortOrder,
        recipients: fromDebt
          ? [
              {
                recipientKind: hasSpouse ? "spouse" : "family_member",
                recipientId: hasSpouse ? null : familyMembers[0]?.id ?? null,
                percentage: 100,
                sortOrder: 0,
              },
            ]
          : draft.recipients,
      });
      return;
    }
    if (value.startsWith(DEBT_PREFIX)) {
      const id = value.slice(DEBT_PREFIX.length);
      const fromAsset = draft.kind === "asset";
      setDraft({
        kind: "liability",
        name: "",
        liabilityId: id,
        percentage: 100,
        condition: "always",
        sortOrder: draft.sortOrder,
        recipients: fromAsset
          ? [
              {
                recipientKind: "family_member",
                recipientId: familyMembers[0]?.id ?? null,
                percentage: 100,
                sortOrder: 0,
              },
            ]
          : draft.recipients,
      });
      return;
    }
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
          <div className={draft.kind === "liability" ? "col-span-3" : "col-span-2"}>
            <label className={fieldLabelClassName}>Asset or debt</label>
            <select
              aria-label="Asset or debt"
              value={selectorValue(draft)}
              onChange={(e) => handleSelectorChange(e.target.value)}
              className={selectClassName}
            >
              <option value={RESIDUAL_VALUE}>Remaining Estate Value</option>
              {accounts.length > 0 && (
                <optgroup label="Assets">
                  {accounts.map((a) => (
                    <option key={a.id} value={`${ASSET_PREFIX}${a.id}`}>
                      {a.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {eligibleLiabilities.length > 0 && (
                <optgroup label="Debts">
                  {eligibleLiabilities.map((l) => {
                    const disabled =
                      alreadyBequeathedLiabilityIds.includes(l.id) &&
                      !(draft.kind === "liability" && draft.liabilityId === l.id);
                    return (
                      <option
                        key={l.id}
                        value={`${DEBT_PREFIX}${l.id}`}
                        disabled={disabled}
                        aria-disabled={disabled}
                      >
                        {l.name}
                        {disabled ? " (already bequeathed)" : ""}
                      </option>
                    );
                  })}
                </optgroup>
              )}
            </select>
          </div>

          {draft.kind === "asset" && (
            <div>
              <label className={fieldLabelClassName}>Percentage</label>
              <input
                type="number"
                aria-label="Percentage"
                min={0.01}
                max={100}
                step={0.01}
                value={draft.percentage}
                onChange={(e) =>
                  setDraft({ ...draft, percentage: parseFloat(e.target.value) || 0 })
                }
                className={inputClassName}
              />
            </div>
          )}
        </div>

        {draft.kind === "asset" && hasSpouse && (
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
          mode={draft.kind === "liability" ? "debt" : "asset"}
          rows={draft.recipients}
          onChange={(recipients) => setDraft({ ...draft, recipients })}
          primary={primary}
          familyMembers={familyMembers}
          externalBeneficiaries={externalBeneficiaries}
          entities={entities}
        />

        {draft.kind === "liability" && recipientSumOk && debtRemainder > 0.009 && (
          <p className="text-xs text-ink-3">
            Recipients sum to {recipientSum.toFixed(2)}% — remainder ({debtRemainder.toFixed(2)}%)
            falls to estate creditor-payoff
          </p>
        )}
      </form>
    </DialogShell>
  );
}
