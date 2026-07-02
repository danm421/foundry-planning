"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import DialogShell from "./dialog-shell";
import AddAccountForm, { AccountFormInitial, EntityOption, CategoryDefaults, ModelPortfolioOption, BusinessOption } from "./forms/add-account-form";
import type { FundPortfolioOption } from "@/lib/investments/load-fund-portfolio-options";
import AddNoteReceivableForm, { NoteReceivableFormInitial } from "./forms/add-note-receivable-form";
import { type AssetClassOption } from "./forms/asset-mix-tab";
import type { ClientMilestones } from "@/lib/milestones";

type AccountCategory = "taxable" | "cash" | "retirement" | "annuity" | "real_estate" | "business" | "life_insurance" | "notes_receivable" | "stock_options" | "education_savings";

interface AddAccountDialogProps {
  clientId: string;
  category?: AccountCategory;
  label?: string;
  // Controlled edit mode
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  editing?: AccountFormInitial;
  /** When set, opens the dialog in edit mode for a notes_receivable row.
   * Takes precedence over `editing` and forces the AddNoteReceivableForm path. */
  editingNote?: NoteReceivableFormInitial;
  onRequestDelete?: () => void;
  entities?: EntityOption[];
  /** Top-level business accounts available as parents for the new account. */
  businesses?: BusinessOption[];
  /** Household Roth IRA accounts offered as a 529→Roth SECURE 2.0 rollover destination. */
  rothIraAccounts?: BusinessOption[];
  familyMembers?: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
  categoryDefaults?: CategoryDefaults;
  modelPortfolios?: ModelPortfolioOption[];
  fundPortfolios?: FundPortfolioOption[];
  ownerNames?: { clientName: string; spouseName: string | null };
  assetClasses?: AssetClassOption[];
  portfolioAllocationsMap?: Record<string, { assetClassId: string; weight: number }[]>;
  categoryDefaultSources?: Record<string, { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }>;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  existingAccountNames?: string[];
  resolvedInflationRate?: number;
  /** Seeds parent-business on create so the dialog defaults the new account to
   *  being owned by that business (used by "+ Add sub-account"). */
  initialParentAccountId?: string | null;
  initialTab?: "details" | "savings" | "realization" | "asset_mix" | "beneficiaries" | "holdings";
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
  editingNote,
  onRequestDelete,
  entities,
  businesses,
  rothIraAccounts,
  familyMembers,
  categoryDefaults,
  modelPortfolios,
  fundPortfolios,
  ownerNames,
  assetClasses,
  portfolioAllocationsMap,
  categoryDefaultSources,
  milestones,
  clientFirstName,
  spouseFirstName,
  existingAccountNames,
  resolvedInflationRate,
  initialParentAccountId,
  initialTab,
  lockTab,
}: AddAccountDialogProps) {
  const router = useRouter();
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const actualOpen = isControlled ? !!open : internalOpen;
  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true,
    loading: false,
  });
  const isEdit = Boolean(editing) || Boolean(editingNote);
  const isNoteCategory = category === "notes_receivable" || Boolean(editingNote);

  // Track whether any autosave occurred so we can refresh the balance sheet
  // on close (mirrors the liability dialog pattern).
  const autoSavedRef = useRef(false);

  function close() {
    if (autoSavedRef.current) {
      router.refresh();
      autoSavedRef.current = false;
    }
    if (isControlled) onOpenChange?.(false);
    else setInternalOpen(false);
  }

  return (
    <>
      {!isControlled && (
        <button
          onClick={() => setInternalOpen(true)}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-gray-300 hover:bg-accent/15 hover:text-accent"
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
          title={
            !isEdit
              ? `Add ${label ?? ""} Account`.trim()
              : editingNote
              ? "Edit Note Receivable"
              : "Edit Account"
          }
          size="md"
          bodyTopFlush={!isNoteCategory}
          fixedHeight={!lockTab}
          primaryAction={{
            label: isEdit ? "Save Changes" : "Add Account",
            form: isNoteCategory ? "add-note-receivable-form" : "add-account-form",
            disabled: !submitState.canSubmit,
            loading: submitState.loading,
          }}
          destructiveAction={
            isEdit && onRequestDelete && !editing?.isDefaultChecking
              ? { label: "Delete", onClick: onRequestDelete }
              : undefined
          }
        >
          {isNoteCategory ? (
            <AddNoteReceivableForm
              clientId={clientId}
              entities={entities}
              familyMembers={familyMembers}
              milestones={milestones}
              clientFirstName={clientFirstName}
              spouseFirstName={spouseFirstName}
              mode={isEdit ? "edit" : "create"}
              initial={editingNote}
              onSuccess={close}
              onSubmitStateChange={setSubmitState}
              onAutoSaved={() => {
                autoSavedRef.current = true;
              }}
            />
          ) : (
            <AddAccountForm
              clientId={clientId}
              category={category}
              mode={isEdit ? "edit" : "create"}
              initial={editing}
              entities={entities}
              businesses={businesses}
              rothIraAccounts={rothIraAccounts}
              familyMembers={familyMembers}
              categoryDefaults={categoryDefaults}
              modelPortfolios={modelPortfolios}
              fundPortfolios={fundPortfolios}
              ownerNames={ownerNames}
              assetClasses={assetClasses}
              portfolioAllocationsMap={portfolioAllocationsMap}
              categoryDefaultSources={categoryDefaultSources}
              milestones={milestones}
              clientFirstName={clientFirstName}
              spouseFirstName={spouseFirstName}
              existingAccountNames={existingAccountNames}
              resolvedInflationRate={resolvedInflationRate}
              initialParentAccountId={initialParentAccountId}
              initialTab={initialTab}
              lockTab={lockTab}
              onSuccess={close}
              onSubmitStateChange={setSubmitState}
              onAutoSaved={() => {
                autoSavedRef.current = true;
              }}
            />
          )}
        </DialogShell>
      )}
    </>
  );
}
