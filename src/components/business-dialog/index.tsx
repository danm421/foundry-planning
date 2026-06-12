"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const NOOP = () => {};
import DialogShell from "../dialog-shell";
import TabAutoSaveIndicator from "../tab-auto-save-indicator";
import { useTabAutoSave } from "@/lib/use-tab-auto-save";
import BusinessDetailsForm from "./details-form";
import BusinessNotesTab from "./notes-tab";
import BusinessAssetsTab from "./business-assets-tab";
import type { BusinessAssetsTabProps } from "./business-assets-tab";
import BusinessFlowsTab from "./business-flows-tab";
import type { BusinessFlowRow } from "./business-flows-tab";
import type { ScheduleSaveBinding, FlowScheduleGridOverride } from "../forms/flow-schedule-grid";
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
  allAccounts?: BusinessAssetsTabProps["allAccounts"];
  allLiabilities?: BusinessAssetsTabProps["allLiabilities"];
  onDataChanged?: () => void;
  onOpenAddAccount?: (businessId: string) => void;
  onOpenAddLiability?: (businessId: string) => void;
  incomes?: BusinessFlowRow[];
  expenses?: BusinessFlowRow[];
  onOpenAddIncome?: () => void;
  onOpenAddExpense?: () => void;
  onEditIncome?: (id: string) => void;
  onEditExpense?: (id: string) => void;
  /** Schedule-grid context — when all three are present the Flows tab shows the
   *  Annual ↔ Schedule toggle and the schedule grid in schedule mode. */
  planStartYear?: number;
  planEndYear?: number;
  primaryClientBirthYear?: number;
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
  allAccounts,
  allLiabilities,
  onDataChanged,
  onOpenAddAccount,
  onOpenAddLiability,
  incomes,
  expenses,
  onOpenAddIncome,
  onOpenAddExpense,
  onEditIncome,
  onEditExpense,
  planStartYear,
  planEndYear,
  primaryClientBirthYear,
}: BusinessDialogProps) {
  const searchParams = useSearchParams();
  const scenarioId = searchParams.get("scenario");

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

  // FlowScheduleGrid registers its save handler here so the dialog's tab-change
  // autosave can drive it.
  const [scheduleSaveBinding, setScheduleSaveBinding] =
    useState<ScheduleSaveBinding | null>(null);
  // Pre-loaded overrides for the schedule grid. Refetched whenever the business
  // (or active scenario) changes. Matches entity-dialog's pattern: early-return
  // without resetting state when there's no business yet (the dialog hides the
  // schedule grid in that case anyway).
  const [initialFlowOverrides, setInitialFlowOverrides] = useState<
    FlowScheduleGridOverride[]
  >([]);
  useEffect(() => {
    if (!currentBusiness?.id) return;
    const url = scenarioId
      ? `/api/clients/${clientId}/accounts/${currentBusiness.id}/flow-overrides?scenarioId=${scenarioId}`
      : `/api/clients/${clientId}/accounts/${currentBusiness.id}/flow-overrides`;
    fetch(url)
      .then((r) => r.json())
      .then((j: { overrides?: FlowScheduleGridOverride[] }) =>
        setInitialFlowOverrides(j.overrides ?? []),
      )
      .catch(() => setInitialFlowOverrides([]));
  }, [clientId, currentBusiness?.id, scenarioId]);

  // Saves the active tab. Flows routes to the schedule-grid binding when the
  // user is in schedule mode; every other tab uses the details form's autosave
  // handle.
  const flowsBinding = tab === "flows" ? scheduleSaveBinding : null;
  const saveAsync = useCallback(async () => {
    if (tab === "flows" && flowsBinding) {
      return flowsBinding.save();
    }
    const handle = formRef.current;
    if (!handle) return { ok: true as const };
    const result = await handle.saveAsync();
    if (result.ok && "account" in result && result.account) {
      // Flip to edit mode on first successful POST so the inert tabs become live.
      setMode("edit");
      setCurrentBusiness(result.account as BusinessAccount);
    }
    return result;
  }, [tab, flowsBinding]);

  const autoSave = useTabAutoSave({
    isDirty: flowsBinding ? flowsBinding.isDirty : autoSaveState.isDirty,
    canSave: flowsBinding ? true : autoSaveState.canSave,
    saveAsync,
  });

  if (!open) return null;

  const isEdit = mode === "edit";
  const title = isEdit ? "Edit Business" : "Add Business";

  // Details has its primary form action; Assets / Notes are inline. Flows
  // exposes a footer save button only in schedule mode (via the schedule-grid
  // binding); annual mode has no footer action.
  const onFlowsTab = tab === "flows";
  const noPrimaryAction =
    tab === "assets" || tab === "notes" || (onFlowsTab && !flowsBinding);

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      tabs={TABS}
      activeTab={tab}
      onTabChange={(next) =>
        void autoSave.interceptTabChange(
          next,
          (n) => setTab(n as BusinessTab),
          // Flows / Assets / Notes are keyed on the business id — force-create
          // the business when opening one on a not-yet-saved record so the tab
          // is usable without a save + reopen.
          { force: !currentBusiness && next !== "details" },
        )
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
          : onFlowsTab && flowsBinding
          ? {
              label: "Save schedule",
              onClick: () => {
                void flowsBinding.save();
              },
              loading: flowsBinding.saving,
              disabled: !flowsBinding.isDirty,
            }
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
      {currentBusiness && (
        <BusinessAssetsTab
          clientId={clientId}
          businessId={currentBusiness.id}
          businessName={currentBusiness.name}
          allAccounts={allAccounts ?? []}
          allLiabilities={allLiabilities ?? []}
          familyMembers={(familyMembers ?? []).map(({ id, firstName }) => ({ id, firstName }))}
          hidden={tab !== "assets"}
          onChanged={() => onDataChanged?.()}
          onOpenAddAccount={onOpenAddAccount ?? NOOP}
          onOpenAddLiability={onOpenAddLiability ?? NOOP}
        />
      )}
      {!currentBusiness && tab === "assets" && (
        <p className="text-[13px] text-ink-3 text-center py-6">
          Assets are available after the business is saved.
        </p>
      )}
      {currentBusiness && (
        <BusinessFlowsTab
          clientId={clientId}
          businessId={currentBusiness.id}
          incomes={incomes ?? []}
          expenses={expenses ?? []}
          hidden={tab !== "flows"}
          flowMode={currentBusiness.flowMode ?? "annual"}
          planStartYear={planStartYear}
          planEndYear={planEndYear}
          primaryClientBirthYear={primaryClientBirthYear}
          initialFlowOverrides={initialFlowOverrides}
          onScheduleSaveBindingChange={setScheduleSaveBinding}
          onOpenAddIncome={onOpenAddIncome ?? NOOP}
          onOpenAddExpense={onOpenAddExpense ?? NOOP}
          onEditIncome={onEditIncome ?? NOOP}
          onEditExpense={onEditExpense ?? NOOP}
        />
      )}
      {!currentBusiness && tab === "flows" && (
        <p className="text-[13px] text-ink-3 text-center py-6">
          Flows are available after the business is saved.
        </p>
      )}
    </DialogShell>
  );
}
