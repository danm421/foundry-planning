"use client";

import { useState } from "react";
import DialogShell from "./dialog-shell";
import AddAccountForm, { AccountFormInitial, EntityOption, CategoryDefaults, ModelPortfolioOption } from "./forms/add-account-form";
import { type AssetClassOption } from "./forms/asset-mix-tab";
import type { ClientMilestones } from "@/lib/milestones";

type AccountCategory = "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";

interface AddAccountDialogProps {
  clientId: string;
  category?: AccountCategory;
  label?: string;
  // Controlled edit mode
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  editing?: AccountFormInitial;
  onRequestDelete?: () => void;
  entities?: EntityOption[];
  categoryDefaults?: CategoryDefaults;
  modelPortfolios?: ModelPortfolioOption[];
  ownerNames?: { clientName: string; spouseName: string | null };
  assetClasses?: AssetClassOption[];
  portfolioAllocationsMap?: Record<string, { assetClassId: string; weight: number }[]>;
  categoryDefaultSources?: Record<string, { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }>;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  existingAccountNames?: string[];
  resolvedInflationRate?: number;
  initialTab?: "details" | "savings" | "realization" | "asset_mix" | "beneficiaries";
  /**
   * When true, restrict the dialog to the Beneficiaries tab: hide all other tab
   * buttons and unmount their panels. Used by the Beneficiary Summary deep-link
   * where `initial` is hydrated from a lite shape (zero values for basis/value/etc),
   * so allowing the user to reach Details would silently overwrite real data on Save.
   */
  lockTab?: boolean;
}

export default function AddAccountDialog({
  clientId,
  category,
  label,
  open,
  onOpenChange,
  editing,
  onRequestDelete,
  entities,
  categoryDefaults,
  modelPortfolios,
  ownerNames,
  assetClasses,
  portfolioAllocationsMap,
  categoryDefaultSources,
  milestones,
  clientFirstName,
  spouseFirstName,
  existingAccountNames,
  resolvedInflationRate,
  initialTab,
  lockTab,
}: AddAccountDialogProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = isControlled ? !!open : internalOpen;
  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true,
    loading: false,
  });
  const isEdit = Boolean(editing);

  function close() {
    if (isControlled) onOpenChange?.(false);
    else setInternalOpen(false);
  }

  return (
    <>
      {!isControlled && (
        <button
          onClick={() => setInternalOpen(true)}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-gray-300 hover:bg-blue-900 hover:text-blue-400"
          aria-label={`Add ${label ?? ""} account`}
          title={`Add ${label ?? ""} account`}
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {actualOpen && (
        <DialogShell
          open={actualOpen}
          onOpenChange={(o) => {
            if (!o) close();
          }}
          title={isEdit ? "Edit Account" : `Add ${label ?? ""} Account`.trim()}
          size="md"
          primaryAction={{
            label: isEdit ? "Save Changes" : "Add Account",
            form: "add-account-form",
            disabled: !submitState.canSubmit,
            loading: submitState.loading,
          }}
          destructiveAction={
            isEdit && onRequestDelete && !editing?.isDefaultChecking
              ? { label: "Delete", onClick: onRequestDelete }
              : undefined
          }
        >
          <AddAccountForm
            clientId={clientId}
            category={category}
            mode={isEdit ? "edit" : "create"}
            initial={editing}
            entities={entities}
            categoryDefaults={categoryDefaults}
            modelPortfolios={modelPortfolios}
            ownerNames={ownerNames}
            assetClasses={assetClasses}
            portfolioAllocationsMap={portfolioAllocationsMap}
            categoryDefaultSources={categoryDefaultSources}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
            existingAccountNames={existingAccountNames}
            resolvedInflationRate={resolvedInflationRate}
            initialTab={initialTab}
            lockTab={lockTab}
            onSuccess={close}
            onSubmitStateChange={setSubmitState}
          />
        </DialogShell>
      )}
    </>
  );
}
