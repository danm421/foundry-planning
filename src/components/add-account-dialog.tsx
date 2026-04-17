"use client";

import { useState } from "react";
import AddAccountForm, { AccountFormInitial, EntityOption, CategoryDefaults, ModelPortfolioOption } from "./forms/add-account-form";
import { type AssetClassOption } from "./forms/asset-mix-tab";

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
}: AddAccountDialogProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = isControlled ? !!open : internalOpen;
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
          className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:bg-blue-900 hover:text-blue-400"
          aria-label={`Add ${label ?? ""} account`}
          title={`Add ${label ?? ""} account`}
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {actualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative z-10 w-full max-w-2xl rounded-lg bg-gray-900 border border-gray-700 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-100">
                {isEdit ? "Edit Account" : `Add ${label ?? ""} Account`}
              </h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-200" aria-label="Close">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
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
              onSuccess={close}
              onDelete={onRequestDelete}
            />
          </div>
        </div>
      )}
    </>
  );
}
