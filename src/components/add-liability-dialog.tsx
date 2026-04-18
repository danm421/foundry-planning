"use client";

import { useState, useCallback } from "react";
import AddLiabilityForm, { LiabilityFormInitial, LiabilityFormValues } from "./forms/add-liability-form";
import LiabilityAmortizationTab from "./liability-amortization-tab";
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

      {actualOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="absolute inset-0 bg-black/40" onClick={close} />
          <div className="relative z-10 w-full max-w-2xl rounded-lg bg-gray-900 border border-gray-700 p-6 shadow-xl my-auto max-h-[90vh] flex flex-col">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-100">
                {isEdit ? "Edit Liability" : "Add Liability"}
              </h2>
              <button onClick={close} className="text-gray-400 hover:text-gray-200" aria-label="Close">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            {/* Tab bar */}
            <div className="mb-4 flex border-b border-gray-700">
              <button
                onClick={() => setActiveTab("details")}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "details"
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                Details
              </button>
              <button
                onClick={() => setActiveTab("amortization")}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === "amortization"
                    ? "border-blue-500 text-blue-400"
                    : "border-transparent text-gray-400 hover:text-gray-200"
                }`}
              >
                Amortization
              </button>
            </div>

            {/* Tab content */}
            <div className="min-h-0 flex-1 overflow-y-auto">
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
            </div>
          </div>
        </div>
      )}
    </>
  );
}
