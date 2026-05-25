"use client";

import { useCallback, useRef, useState } from "react";
import DialogShell from "../dialog-shell";
import TabAutoSaveIndicator from "../tab-auto-save-indicator";
import { useTabAutoSave } from "@/lib/use-tab-auto-save";
import BusinessDetailsForm from "./details-form";
import BusinessNotesTab from "./notes-tab";
import type {
  BusinessAccount,
  BusinessDialogMode,
  BusinessFormAutoSaveHandle,
  BusinessTab,
} from "./types";

export interface BusinessDialogProps {
  clientId: string;
  mode: BusinessDialogMode;
  /** Required when mode === "edit". */
  business?: BusinessAccount;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fires on explicit user submit (dialog-close signal). */
  onSaved?: (business: BusinessAccount, mode: "create" | "edit") => void;
  /** Fires on every successful tab-switch autosave. */
  onAutoSaved?: (business: BusinessAccount, mode: "create" | "edit") => void;
  /** Optional delete handler — only shown in edit mode. */
  onRequestDelete?: () => void;
  familyMembers?: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  entities?: { id: string; name: string }[];
}

const TABS: { id: BusinessTab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "flows", label: "Flows" },
  { id: "assets", label: "Assets" },
  { id: "notes", label: "Notes" },
];

export default function BusinessDialog({
  clientId,
  mode: initialMode,
  business,
  open,
  onOpenChange,
  onSaved,
  onAutoSaved,
  onRequestDelete,
  familyMembers,
  entities,
}: BusinessDialogProps) {
  const [tab, setTab] = useState<BusinessTab>("details");
  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true,
    loading: false,
  });
  // Flips from "add" → "edit" after first successful POST so subsequent saves PUT.
  const [mode, setMode] = useState<BusinessDialogMode>(initialMode);
  const [currentBusiness, setCurrentBusiness] = useState<BusinessAccount | undefined>(business);

  const formRef = useRef<BusinessFormAutoSaveHandle | null>(null);
  const [autoSaveState, setAutoSaveState] = useState<{ isDirty: boolean; canSave: boolean }>({
    isDirty: false,
    canSave: true,
  });

  const saveAsync = useCallback(async () => {
    const handle = formRef.current;
    if (!handle) return { ok: true as const };
    const result = await handle.saveAsync();
    if (result.ok && "account" in result && result.account) {
      // Flip to edit mode on first successful POST so the inert tabs become live.
      setMode("edit");
      setCurrentBusiness(result.account as BusinessAccount);
    }
    return result;
  }, []);

  const autoSave = useTabAutoSave({
    isDirty: autoSaveState.isDirty,
    canSave: autoSaveState.canSave,
    saveAsync,
  });

  if (!open) return null;

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit Business" : "Add Business";

  // Assets / Flows / Notes have no primary form action — their content is managed inline.
  const noPrimaryAction = tab !== "details";

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      tabs={TABS}
      activeTab={tab}
      onTabChange={(next) =>
        void autoSave.interceptTabChange(next, (n) => setTab(n as BusinessTab))
      }
      tabBarRight={
        <TabAutoSaveIndicator
          saving={autoSave.saving}
          error={autoSave.saveError}
          onDismissError={autoSave.clearSaveError}
        />
      }
      primaryAction={
        noPrimaryAction
          ? undefined
          : {
              label: isEdit ? "Save Changes" : "Add Business",
              form: "business-details-form",
              disabled: !submitState.canSubmit,
              loading: submitState.loading,
            }
      }
      destructiveAction={
        isEdit && onRequestDelete ? { label: "Delete", onClick: onRequestDelete } : undefined
      }
    >
      <BusinessDetailsForm
        ref={formRef}
        clientId={clientId}
        editing={currentBusiness}
        activeTab={tab}
        familyMembers={familyMembers ?? []}
        entities={entities ?? []}
        onSaved={(b, m) => {
          setCurrentBusiness(b);
          onSaved?.(b, m);
        }}
        onAutoSaved={(b, m) => {
          setCurrentBusiness(b);
          onAutoSaved?.(b, m);
        }}
        onClose={() => onOpenChange(false)}
        onSubmitStateChange={setSubmitState}
        onAutoSaveStateChange={setAutoSaveState}
      />
      {currentBusiness && (
        <BusinessNotesTab
          clientId={clientId}
          business={currentBusiness}
          hidden={tab !== "notes"}
        />
      )}
      {!currentBusiness && tab === "notes" && (
        <p className="text-[13px] text-ink-3 text-center py-6">
          Notes are available after the business is saved.
        </p>
      )}
    </DialogShell>
  );
}
