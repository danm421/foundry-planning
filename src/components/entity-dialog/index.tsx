"use client";

import { useState } from "react";
import AddTrustForm from "../forms/add-trust-form";
import BusinessForm from "./business-form";
import { getEntityKind, type EntityKind } from "./types";
import type { Entity, FamilyMember, ExternalBeneficiary, Designation } from "../family-view";
import type { AssetsTabAccount, AssetsTabLiability, AssetsTabIncome, AssetsTabExpense, AssetsTabFamilyMember } from "../forms/assets-tab";
import DialogShell from "../dialog-shell";

export interface EntityDialogProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When editing, kind is inferred from editing.entityType. When creating, the picker supplies kind. */
  createKind?: EntityKind;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
  /** Required for trust dialogs — caller supplies household/member data */
  household: { client: { firstName: string }; spouse: { firstName: string } | null };
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  /** Other entities for the remainder picker (excludes self) */
  otherEntities: { id: string; name: string }[];
  /** Pre-loaded designations for edit mode */
  initialDesignations?: Designation[];
  /** Assets tab data — when absent the Assets tab degrades gracefully */
  accounts?: AssetsTabAccount[];
  liabilities?: AssetsTabLiability[];
  incomes?: AssetsTabIncome[];
  expenses?: AssetsTabExpense[];
  assetFamilyMembers?: AssetsTabFamilyMember[];
}

type TrustTab = "details" | "assets" | "transfers" | "notes";
type BusinessTab = "details" | "assets" | "notes";

export default function EntityDialog({
  clientId,
  open,
  onOpenChange,
  createKind,
  editing,
  onSaved,
  onRequestDelete,
  household,
  members,
  externals,
  otherEntities,
  initialDesignations,
  accounts,
  liabilities,
  incomes,
  expenses,
  assetFamilyMembers,
}: EntityDialogProps) {
  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true,
    loading: false,
  });
  const [trustTab, setTrustTab] = useState<TrustTab>("details");
  const [businessTab, setBusinessTab] = useState<BusinessTab>("details");

  if (!open) return null;

  const kind: EntityKind = editing ? getEntityKind(editing.entityType) : (createKind ?? "trust");
  const isEdit = Boolean(editing);
  const title = isEdit
    ? kind === "trust" ? "Edit Trust" : "Edit Business"
    : kind === "trust" ? "Add Trust" : "Add Business";

  const tabs =
    kind === "trust"
      ? [
          { id: "details", label: "Details" },
          { id: "assets", label: "Assets" },
          { id: "transfers", label: "Transfers" },
          { id: "notes", label: "Notes" },
        ]
      : [
          { id: "details", label: "Details" },
          { id: "assets", label: "Assets" },
          { id: "notes", label: "Notes" },
        ];

  const activeTab = kind === "trust" ? trustTab : businessTab;
  const onTabChange = (tab: string) => {
    if (kind === "trust") setTrustTab(tab as TrustTab);
    else setBusinessTab(tab as BusinessTab);
  };

  // Tabs that don't own a primary form action (Assets / Transfers manage their own data inline).
  const noPrimaryAction =
    (kind === "trust" && (trustTab === "assets" || trustTab === "transfers")) ||
    (kind === "business" && businessTab === "assets");

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
      primaryAction={
        noPrimaryAction
          ? undefined
          : {
              label: isEdit ? "Save Changes" : kind === "trust" ? "Add Trust" : "Add Business",
              form: kind === "trust" ? "add-trust-form" : "entity-business-form",
              disabled: !submitState.canSubmit,
              loading: submitState.loading,
            }
      }
      destructiveAction={
        isEdit && onRequestDelete
          ? { label: "Delete", onClick: onRequestDelete }
          : undefined
      }
    >
      {kind === "trust" ? (
        <AddTrustForm
          clientId={clientId}
          editing={editing}
          household={household}
          members={members}
          externals={externals}
          entities={otherEntities}
          initialDesignations={initialDesignations}
          activeTab={trustTab}
          accounts={accounts}
          liabilities={liabilities}
          incomes={incomes}
          expenses={expenses}
          assetFamilyMembers={assetFamilyMembers}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
          onSubmitStateChange={setSubmitState}
        />
      ) : (
        <BusinessForm
          clientId={clientId}
          editing={editing}
          activeTab={businessTab}
          accounts={accounts}
          liabilities={liabilities}
          incomes={incomes}
          expenses={expenses}
          assetFamilyMembers={assetFamilyMembers}
          otherEntities={otherEntities}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
          onSubmitStateChange={setSubmitState}
        />
      )}
    </DialogShell>
  );
}
