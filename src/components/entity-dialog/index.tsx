"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import AddTrustForm from "../forms/add-trust-form";
import BusinessForm from "./business-form";
import { getEntityKind, type EntityKind } from "./types";
import type { Entity, FamilyMember, ExternalBeneficiary, Designation } from "../family-view";
import type { AssetsTabAccount, AssetsTabLiability, AssetsTabIncome, AssetsTabExpense, AssetsTabFamilyMember } from "../forms/assets-tab";
import type { FlowsTabIncome, FlowsTabExpense } from "../forms/flows-tab";
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
  /** Schedule modal context — derived from client plan settings + primary client DOB */
  planEndYear?: number;
  primaryClientBirthYear?: number;
}

type TrustTab = "details" | "flows" | "assets" | "transfers" | "notes";
type BusinessTab = "details" | "flows" | "assets" | "notes";

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

  const tabs =
    kind === "trust"
      ? [
          { id: "details", label: "Details" },
          { id: "flows", label: "Flows" },
          { id: "assets", label: "Assets" },
          { id: "transfers", label: "Transfers" },
          { id: "notes", label: "Notes" },
        ]
      : [
          { id: "details", label: "Details" },
          { id: "flows", label: "Flows" },
          { id: "assets", label: "Assets" },
          { id: "notes", label: "Notes" },
        ];

  const activeTab = kind === "trust" ? trustTab : businessTab;
  const onTabChange = (tab: string) => {
    if (kind === "trust") setTrustTab(tab as TrustTab);
    else setBusinessTab(tab as BusinessTab);
  };

  // Tabs that don't own a primary form action (Assets / Transfers / Flows manage their own data inline).
  const noPrimaryAction =
    (kind === "trust" && (trustTab === "assets" || trustTab === "transfers" || trustTab === "flows")) ||
    (kind === "business" && (businessTab === "assets" || businessTab === "flows"));

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
          entityIncome={entityIncome}
          entityExpense={entityExpense}
          assetFamilyMembers={assetFamilyMembers}
          planEndYear={planEndYear}
          primaryClientBirthYear={primaryClientBirthYear}
          initialFlowOverrides={initialFlowOverrides}
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
        />
      )}
    </DialogShell>
  );
}
