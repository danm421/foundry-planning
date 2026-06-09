// src/components/revocable-trust-dialog.tsx
"use client";

import { useCallback, useRef, useState } from "react";
import RevocableTrustForm, { type RevocableTrustFormHandle } from "./forms/revocable-trust-form";
import type { Entity, FamilyMember, ExternalBeneficiary, Designation } from "./family-view";
import type {
  AssetsTabAccount, AssetsTabLiability, AssetsTabIncome, AssetsTabExpense, AssetsTabFamilyMember,
} from "./forms/assets-tab";
import DialogShell from "./dialog-shell";
import TabAutoSaveIndicator from "./tab-auto-save-indicator";
import { useTabAutoSave } from "@/lib/use-tab-auto-save";

export interface RevocableTrustDialogProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  onAutoSaved?: (entity: Entity, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
  household: { client: { firstName: string }; spouse: { firstName: string } | null };
  members: FamilyMember[];
  externals: ExternalBeneficiary[];
  otherEntities: { id: string; name: string }[];
  initialDesignations?: Designation[];
  accounts?: AssetsTabAccount[];
  liabilities?: AssetsTabLiability[];
  incomes?: AssetsTabIncome[];
  expenses?: AssetsTabExpense[];
  assetFamilyMembers?: AssetsTabFamilyMember[];
}

type RevTab = "details" | "assets";

export default function RevocableTrustDialog({
  clientId, open, onOpenChange, editing, onSaved, onAutoSaved, onRequestDelete,
  household, members, externals, otherEntities, initialDesignations,
  accounts, liabilities, incomes, expenses, assetFamilyMembers,
}: RevocableTrustDialogProps) {
  const [tab, setTab] = useState<RevTab>("details");
  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true, loading: false,
  });
  const formRef = useRef<RevocableTrustFormHandle | null>(null);
  const [autoState, setAutoState] = useState<{ isDirty: boolean; canSave: boolean }>({
    isDirty: false, canSave: true,
  });

  const saveAsync = useCallback(async () => {
    const h = formRef.current;
    if (!h) return { ok: true as const };
    return h.saveAsync();
  }, []);

  const autoSave = useTabAutoSave({
    isDirty: autoState.isDirty,
    canSave: autoState.canSave,
    saveAsync,
  });

  if (!open) return null;
  const isEdit = Boolean(editing);

  const tabs = [
    { id: "details", label: "Details" },
    { id: "assets", label: "Assets" },
  ];

  const onTabChange = (next: string) =>
    void autoSave.interceptTabChange(next, (n) => setTab(n as RevTab));

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={isEdit ? "Edit Revocable Trust" : "Add Revocable Trust"}
      size="lg"
      fixedHeight
      tabs={tabs}
      activeTab={tab}
      onTabChange={onTabChange}
      tabBarRight={
        <TabAutoSaveIndicator
          saving={autoSave.saving}
          error={autoSave.saveError}
          onDismissError={autoSave.clearSaveError}
        />
      }
      primaryAction={
        tab === "assets"
          ? undefined // Assets tab manages its data inline
          : {
              label: isEdit ? "Save Changes" : "Add Trust",
              form: "revocable-trust-form",
              disabled: !submitState.canSubmit,
              loading: submitState.loading,
            }
      }
      destructiveAction={
        isEdit && onRequestDelete ? { label: "Delete", onClick: onRequestDelete } : undefined
      }
    >
      <RevocableTrustForm
        ref={formRef}
        clientId={clientId}
        editing={editing}
        household={household}
        members={members}
        externals={externals}
        otherEntities={otherEntities}
        initialDesignations={initialDesignations}
        activeTab={tab}
        accounts={accounts}
        liabilities={liabilities}
        incomes={incomes}
        expenses={expenses}
        assetFamilyMembers={assetFamilyMembers}
        onSaved={onSaved}
        onClose={() => onOpenChange(false)}
        onSubmitStateChange={setSubmitState}
        onAutoSaveStateChange={setAutoState}
        onAutoSaved={onAutoSaved}
      />
    </DialogShell>
  );
}
