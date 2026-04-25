"use client";

import { useState, useCallback } from "react";
import AddLiabilityForm, { LiabilityFormInitial, LiabilityFormValues } from "./forms/add-liability-form";
import LiabilityAmortizationTab from "./liability-amortization-tab";
import DialogShell from "./dialog-shell";
import type { ClientMilestones } from "@/lib/milestones";

type TabId = "details" | "amortization";

interface AddLiabilityDialogProps {
  clientId: string;
  realEstateAccounts?: { id: string; name: string }[];
  entities?: { id: string; name: string }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  // Controlled edit mode
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  editing?: LiabilityFormInitial;
  onRequestDelete?: () => void;
}

export default function AddLiabilityDialog({
  clientId,
  realEstateAccounts,
  entities,
  milestones,
  clientFirstName,
  spouseFirstName,
  open,
  onOpenChange,
  editing,
  onRequestDelete,
}: AddLiabilityDialogProps) {
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("details");
  const [liveValues, setLiveValues] = useState<LiabilityFormValues | null>(null);
  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true,
    loading: false,
  });
  const actualOpen = isControlled ? !!open : internalOpen;
  const isEdit = Boolean(editing);

  const handleValuesChange = useCallback((values: LiabilityFormValues) => {
    setLiveValues(values);
  }, []);

  function close() {
    if (isControlled) onOpenChange?.(false);
    else setInternalOpen(false);
    setActiveTab("details");
  }

  return (
    <>
      {!isControlled && (
        <button
          onClick={() => setInternalOpen(true)}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-gray-400 hover:bg-blue-900 hover:text-blue-400"
          aria-label="Add liability"
          title="Add liability"
        >
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      <DialogShell
        open={actualOpen}
        onOpenChange={(o) => { if (!o) close(); }}
        title={isEdit ? "Edit Liability" : "Add Liability"}
        size="md"
        tabs={[
          { id: "details", label: "Details" },
          { id: "amortization", label: "Amortization" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as TabId)}
        primaryAction={
          activeTab === "details"
            ? {
                label: isEdit ? "Save Changes" : "Add Liability",
                form: "add-liability-form",
                disabled: !submitState.canSubmit,
                loading: submitState.loading,
              }
            : undefined
        }
        destructiveAction={
          isEdit && onRequestDelete && activeTab === "details"
            ? { label: "Delete", onClick: onRequestDelete }
            : undefined
        }
      >
        {activeTab === "details" && (
          <AddLiabilityForm
            clientId={clientId}
            realEstateAccounts={realEstateAccounts}
            entities={entities}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
            mode={isEdit ? "edit" : "create"}
            initial={editing}
            onSuccess={close}
            onDelete={onRequestDelete}
            onValuesChange={handleValuesChange}
            onSubmitStateChange={setSubmitState}
          />
        )}
        {activeTab === "amortization" && liveValues && (
          <LiabilityAmortizationTab
            clientId={clientId}
            liabilityId={editing?.id}
            balance={liveValues.balance}
            interestRate={liveValues.interestRate}
            monthlyPayment={liveValues.monthlyPayment}
            startYear={liveValues.startYear}
            startMonth={liveValues.startMonth}
            termMonths={liveValues.termMonths}
            balanceAsOfMonth={liveValues.balanceAsOfMonth}
            balanceAsOfYear={liveValues.balanceAsOfYear}
          />
        )}
      </DialogShell>
    </>
  );
}
