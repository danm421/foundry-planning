"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import AddTrustForm from "../forms/add-trust-form";
import BusinessForm from "./business-form";
import { getEntityKind, type EntityKind } from "./types";
import type { Entity, FamilyMember, ExternalBeneficiary, Designation } from "../family-view";
import type { AssetsTabAccount, AssetsTabLiability, AssetsTabIncome, AssetsTabExpense, AssetsTabFamilyMember, AssetsTabBusiness } from "../forms/assets-tab";
import type { FlowsTabIncome, FlowsTabExpense, ScheduleSaveBinding } from "../forms/flows-tab";
import DialogShell from "../dialog-shell";
import TabAutoSaveIndicator from "../tab-auto-save-indicator";
import { useTabAutoSave } from "@/lib/use-tab-auto-save";
import type { TrustFormAutoSaveHandle } from "../forms/add-trust-form";
import type { BusinessFormAutoSaveHandle } from "./business-form";

export interface EntityDialogProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When editing, kind is inferred from editing.entityType. When creating, the picker supplies kind. */
  createKind?: EntityKind;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  /** Fires on every successful autosave (tab-switch saves). Distinct from onSaved which fires only on explicit user submit. */
  onAutoSaved?: (entity: Entity, mode: "create" | "edit") => void;
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
  /** Business entities available for assignment to a trust via the Assets tab picker. */
  businesses?: AssetsTabBusiness[];
  assetFamilyMembers?: AssetsTabFamilyMember[];
  /** Schedule modal context — derived from client plan settings + primary client DOB */
  planEndYear?: number;
  primaryClientBirthYear?: number;
}

type TrustTab =
  | "details"
  | "flows"
  | "assets"
  | "transfers"
  | "notes"
  | "notes-sales";
type BusinessTab = "details" | "flows" | "assets" | "notes";

/**
 * Mirrors `showNotesAndSales` in add-trust-form.tsx — kept duplicated rather
 * than imported to avoid pulling the giant trust form into the dialog shell.
 * IDGTs always show the tab; other irrevocable grantor trusts (SLAT/GRAT) also
 * qualify. Stays in lockstep with the form-side helper.
 */
function showNotesAndSalesTab(t: { trustSubType: string | null; isIrrevocable: boolean | null; isGrantor: boolean }): boolean {
  if (t.trustSubType === "idgt") return true;
  return Boolean(t.isIrrevocable && t.isGrantor);
}

/**
 * Adapt the assets-tab income/expense row (which carries optional flow-tab
 * metadata from the page-level enrichment) to the FlowsTab shape. Returns null
 * when the row is missing the flow fields — e.g. older callers that only
 * populated id/name/annualAmount/cashAccountId.
 */
function toFlowsTabIncome(
  row: AssetsTabIncome | AssetsTabExpense | undefined,
): FlowsTabIncome | null {
  if (!row) return null;
  if (row.startYear == null || row.endYear == null || row.growthRate == null) return null;
  return {
    id: row.id,
    name: row.name,
    annualAmount: row.annualAmount,
    startYear: row.startYear,
    endYear: row.endYear,
    growthRate: row.growthRate,
    growthSource: row.growthSource === "custom" ? "custom" : "inflation",
    inflationStartYear: row.inflationStartYear ?? null,
  };
}

export default function EntityDialog({
  clientId,
  open,
  onOpenChange,
  createKind,
  editing,
  onSaved,
  onAutoSaved,
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
  businesses,
  assetFamilyMembers,
  planEndYear,
  primaryClientBirthYear,
}: EntityDialogProps) {
  const searchParams = useSearchParams();

  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true,
    loading: false,
  });
  const [trustTab, setTrustTab] = useState<TrustTab>("details");
  const [businessTab, setBusinessTab] = useState<BusinessTab>("details");

  const [initialFlowOverrides, setInitialFlowOverrides] = useState<Array<{
    year: number;
    incomeAmount: number | null;
    expenseAmount: number | null;
    distributionPercent: number | null;
  }>>([]);

  // FlowScheduleGrid registers its save handler here so the dialog footer can drive it.
  const [scheduleSaveBinding, setScheduleSaveBinding] =
    useState<ScheduleSaveBinding | null>(null);

  const trustFormRef = useRef<TrustFormAutoSaveHandle | null>(null);
  const [trustAutoSaveState, setTrustAutoSaveState] = useState<{ isDirty: boolean; canSave: boolean }>({
    isDirty: false,
    canSave: true,
  });
  const [liveTrustState, setLiveTrustState] = useState<{ trustSubType: string; isGrantor: boolean; isIrrevocable: boolean }>({
    trustSubType: editing?.trustSubType ?? "",
    isGrantor: editing?.isGrantor ?? false,
    isIrrevocable: editing?.isIrrevocable ?? false,
  });
  const trustSaveAsync = useCallback(async () => {
    const handle = trustFormRef.current;
    if (!handle) return { ok: true as const };
    return handle.saveAsync();
  }, []);

  const trustAutoSave = useTabAutoSave({
    isDirty: trustAutoSaveState.isDirty,
    canSave: trustAutoSaveState.canSave,
    saveAsync: trustSaveAsync,
  });

  const businessFormRef = useRef<BusinessFormAutoSaveHandle | null>(null);
  const [businessAutoSaveState, setBusinessAutoSaveState] = useState<{ isDirty: boolean; canSave: boolean }>({
    isDirty: false,
    canSave: true,
  });

  const businessSaveAsync = useCallback(async () => {
    const handle = businessFormRef.current;
    if (!handle) return { ok: true as const };
    return handle.saveAsync();
  }, []);

  const businessAutoSave = useTabAutoSave({
    isDirty: businessAutoSaveState.isDirty,
    canSave: businessAutoSaveState.canSave,
    saveAsync: businessSaveAsync,
  });

  const scenarioId = searchParams.get("scenario");

  useEffect(() => {
    if (!editing?.id) return;
    // Omitting scenarioId (base mode) loads scenario_id IS NULL overrides.
    const url = scenarioId
      ? `/api/clients/${clientId}/entities/${editing.id}/flow-overrides?scenarioId=${scenarioId}`
      : `/api/clients/${clientId}/entities/${editing.id}/flow-overrides`;
    fetch(url)
      .then((r) => r.json())
      .then((j: { overrides?: Array<{ year: number; incomeAmount: number | null; expenseAmount: number | null; distributionPercent: number | null }> }) =>
        setInitialFlowOverrides(j.overrides ?? []),
      )
      .catch(() => setInitialFlowOverrides([]));
  }, [clientId, editing?.id, scenarioId]);

  if (!open) return null;

  const kind: EntityKind = editing ? getEntityKind(editing.entityType) : (createKind ?? "trust");
  const isEdit = Boolean(editing);
  const title = isEdit
    ? kind === "trust" ? "Edit Trust" : "Edit Business"
    : kind === "trust" ? "Add Trust" : "Add Business";

  const trustShowsNotesAndSales =
    kind === "trust" &&
    showNotesAndSalesTab({
      trustSubType: liveTrustState.trustSubType || null,
      isIrrevocable: liveTrustState.isIrrevocable,
      isGrantor: liveTrustState.isGrantor,
    });

  const tabs =
    kind === "trust"
      ? [
          { id: "details", label: "Details" },
          { id: "flows", label: "Flows" },
          { id: "assets", label: "Assets" },
          { id: "transfers", label: "Transfers" },
          { id: "notes", label: "Notes" },
          ...(trustShowsNotesAndSales
            ? [{ id: "notes-sales", label: "Notes & sales" }]
            : []),
        ]
      : [
          { id: "details", label: "Details" },
          { id: "flows", label: "Flows" },
          { id: "assets", label: "Assets" },
          { id: "notes", label: "Notes" },
        ];

  const activeTab = kind === "trust" ? trustTab : businessTab;
  const autoSave = kind === "trust" ? trustAutoSave : businessAutoSave;
  const onTabChange = (tab: string) => {
    if (kind === "trust") {
      void autoSave.interceptTabChange(tab, (next) => setTrustTab(next as TrustTab));
    } else {
      void autoSave.interceptTabChange(tab, (next) => setBusinessTab(next as BusinessTab));
    }
  };

  // Tabs that don't own a primary form action (Assets / Transfers manage their own data inline).
  // Flows is special: when in custom-schedule mode the grid registers a save binding,
  // which we surface as the primary action below. Annual mode has no primary action.
  const onFlowsTab =
    (kind === "trust" && trustTab === "flows") ||
    (kind === "business" && businessTab === "flows");
  const noPrimaryAction =
    (kind === "trust" &&
      (trustTab === "assets" ||
        trustTab === "transfers" ||
        trustTab === "notes-sales")) ||
    (kind === "business" && businessTab === "assets") ||
    (onFlowsTab && !scheduleSaveBinding);

  // Find the entity-owned income + expense for THIS entity to feed the FlowsTab.
  const entityIncome: FlowsTabIncome | null = editing
    ? toFlowsTabIncome((incomes ?? []).find((i) => i.ownerEntityId === editing.id))
    : null;
  const entityExpense: FlowsTabExpense | null = editing
    ? toFlowsTabIncome((expenses ?? []).find((e) => e.ownerEntityId === editing.id))
    : null;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="md"
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={onTabChange}
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
          : onFlowsTab && scheduleSaveBinding
          ? {
              label: "Save schedule",
              onClick: () => {
                void scheduleSaveBinding.save();
              },
              loading: scheduleSaveBinding.saving,
            }
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
          ref={trustFormRef}
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
          businesses={businesses}
          entityIncome={entityIncome}
          entityExpense={entityExpense}
          assetFamilyMembers={assetFamilyMembers}
          planEndYear={planEndYear}
          primaryClientBirthYear={primaryClientBirthYear}
          initialFlowOverrides={initialFlowOverrides}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
          onSubmitStateChange={setSubmitState}
          onScheduleSaveBindingChange={setScheduleSaveBinding}
          onAutoSaveStateChange={setTrustAutoSaveState}
          onAutoSaved={(e, mode) => onAutoSaved?.(e, mode)}
          onLiveStateChange={setLiveTrustState}
        />
      ) : (
        <BusinessForm
          ref={businessFormRef}
          clientId={clientId}
          editing={editing}
          activeTab={businessTab}
          accounts={accounts}
          liabilities={liabilities}
          incomes={incomes}
          expenses={expenses}
          entityIncome={entityIncome}
          entityExpense={entityExpense}
          assetFamilyMembers={assetFamilyMembers}
          otherEntities={otherEntities}
          planEndYear={planEndYear}
          primaryClientBirthYear={primaryClientBirthYear}
          initialFlowOverrides={initialFlowOverrides}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
          onSubmitStateChange={setSubmitState}
          onScheduleSaveBindingChange={setScheduleSaveBinding}
          onAutoSaveStateChange={setBusinessAutoSaveState}
          onAutoSaved={(e, mode) => onAutoSaved?.(e, mode)}
        />
      )}
    </DialogShell>
  );
}
