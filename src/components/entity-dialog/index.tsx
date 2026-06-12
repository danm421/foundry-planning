"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import AddTrustForm from "../forms/add-trust-form";
import type { Entity, FamilyMember, ExternalBeneficiary, Designation } from "../family-view";
import type { AssetsTabAccount, AssetsTabLiability, AssetsTabIncome, AssetsTabExpense, AssetsTabFamilyMember, AssetsTabBusiness } from "../forms/assets-tab";
import type { FlowsTabIncome, FlowsTabExpense, ScheduleSaveBinding } from "../forms/flows-tab";
import DialogShell from "../dialog-shell";
import TabAutoSaveIndicator from "../tab-auto-save-indicator";
import { useTabAutoSave } from "@/lib/use-tab-auto-save";
import type { TrustFormAutoSaveHandle } from "../forms/add-trust-form";

export interface EntityDialogProps {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: Entity;
  onSaved: (entity: Entity, mode: "create" | "edit") => void;
  /** Fires on every successful autosave (tab-switch saves). Distinct from onSaved which fires only on explicit user submit. */
  onAutoSaved?: (entity: Entity, mode: "create" | "edit") => void;
  onRequestDelete?: () => void;
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
  /** Business accounts available for assignment to a trust via the Assets tab picker. */
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

// Tabs backed by a nested resource keyed on the entity id. Opening one on a
// not-yet-saved trust force-creates it first. ("notes" is a plain field on the
// trust itself, so it doesn't need the record to exist.)
const RECORD_DEPENDENT_TRUST_TABS = new Set<string>([
  "flows",
  "assets",
  "transfers",
  "notes-sales",
]);

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

  // Promote create → edit in place: starts as the `editing` prop and is updated
  // from the form's first auto-save (the dialog is keyed on the entity id, so
  // `editing` is stable for the whole session). The child-data tabs (Flows /
  // Assets / Transfers / Notes & sales) gate on this, so they become usable the
  // moment the trust is minted — no save + reopen. The form seeds its fields
  // only at mount, so swapping this in later doesn't clobber in-progress edits.
  const [currentEntity, setCurrentEntity] = useState<Entity | undefined>(editing);

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

  const autoSave = useTabAutoSave({
    isDirty: trustAutoSaveState.isDirty,
    canSave: trustAutoSaveState.canSave,
    saveAsync: trustSaveAsync,
  });

  const scenarioId = searchParams.get("scenario");

  useEffect(() => {
    if (!currentEntity?.id) return;
    // Omitting scenarioId (base mode) loads scenario_id IS NULL overrides.
    const url = scenarioId
      ? `/api/clients/${clientId}/entities/${currentEntity.id}/flow-overrides?scenarioId=${scenarioId}`
      : `/api/clients/${clientId}/entities/${currentEntity.id}/flow-overrides`;
    fetch(url)
      .then((r) => r.json())
      .then((j: { overrides?: Array<{ year: number; incomeAmount: number | null; expenseAmount: number | null; distributionPercent: number | null }> }) =>
        setInitialFlowOverrides(j.overrides ?? []),
      )
      .catch(() => setInitialFlowOverrides([]));
  }, [clientId, currentEntity?.id, scenarioId]);

  if (!open) return null;

  const isEdit = Boolean(currentEntity);
  const title = isEdit ? "Edit Trust" : "Add Trust";

  const trustShowsNotesAndSales = showNotesAndSalesTab({
    trustSubType: liveTrustState.trustSubType || null,
    isIrrevocable: liveTrustState.isIrrevocable,
    isGrantor: liveTrustState.isGrantor,
  });

  const tabs = [
    { id: "details", label: "Details" },
    { id: "flows", label: "Flows" },
    { id: "assets", label: "Assets" },
    { id: "transfers", label: "Transfers" },
    { id: "notes", label: "Notes" },
    ...(trustShowsNotesAndSales
      ? [{ id: "notes-sales", label: "Notes & sales" }]
      : []),
  ];

  const onTabChange = (tab: string) => {
    // Flows / Assets / Transfers / Notes & sales are keyed on the entity id —
    // force-create the trust when opening one on a not-yet-saved record so the
    // tab is usable without a save + reopen.
    const force = !currentEntity && RECORD_DEPENDENT_TRUST_TABS.has(tab);
    void autoSave.interceptTabChange(tab, (next) => setTrustTab(next as TrustTab), { force });
  };

  // Tabs that don't own a primary form action (Assets / Transfers manage their own data inline).
  // Flows is special: when in custom-schedule mode the grid registers a save binding,
  // which we surface as the primary action below. Annual mode has no primary action.
  const onFlowsTab = trustTab === "flows";
  const noPrimaryAction =
    trustTab === "assets" ||
    trustTab === "transfers" ||
    trustTab === "notes-sales" ||
    (onFlowsTab && !scheduleSaveBinding);

  // Find the entity-owned income + expense for THIS entity to feed the FlowsTab.
  const entityIncome: FlowsTabIncome | null = currentEntity
    ? toFlowsTabIncome((incomes ?? []).find((i) => i.ownerEntityId === currentEntity.id))
    : null;
  const entityExpense: FlowsTabExpense | null = currentEntity
    ? toFlowsTabIncome((expenses ?? []).find((e) => e.ownerEntityId === currentEntity.id))
    : null;

  return (
    <DialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      // Trusts pack two side-by-side beneficiary lists (income + remainder), plus
      // CLT details with a 2-col grid — md is too tight and forces clipping.
      size="lg"
      // Pin the box to a stable height so switching between the tabs (which have
      // very different content lengths) doesn't resize the dialog.
      fixedHeight
      tabs={tabs}
      activeTab={trustTab}
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
              label: isEdit ? "Save Changes" : "Add Trust",
              form: "add-trust-form",
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
      <AddTrustForm
        ref={trustFormRef}
        clientId={clientId}
        editing={currentEntity}
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
        onAutoSaved={(e, mode) => {
          // Promote the dialog to edit mode in place so child-data tabs unlock
          // without a save + reopen.
          setCurrentEntity(e);
          onAutoSaved?.(e, mode);
        }}
        onLiveStateChange={setLiveTrustState}
      />
    </DialogShell>
  );
}
