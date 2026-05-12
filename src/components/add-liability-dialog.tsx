"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import AddLiabilityForm, {
  type LiabilityFormInitial,
  type LiabilityFormValues,
  type LiabilityFormAutoSaveHandle,
} from "./forms/add-liability-form";
import LiabilityAmortizationTab from "./liability-amortization-tab";
import DialogShell from "./dialog-shell";
import TabAutoSaveIndicator from "./tab-auto-save-indicator";
import { useTabAutoSave } from "@/lib/use-tab-auto-save";
import type { ClientMilestones } from "@/lib/milestones";

type TabId = "details" | "amortization";

interface AddLiabilityDialogProps {
  clientId: string;
  realEstateAccounts?: { id: string; name: string }[];
  entities?: { id: string; name: string }[];
  familyMembers?: { id: string; role: "client" | "spouse" | "child" | "other"; firstName: string }[];
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
  familyMembers,
  milestones,
  clientFirstName,
  spouseFirstName,
  open,
  onOpenChange,
  editing,
  onRequestDelete,
}: AddLiabilityDialogProps) {
  const router = useRouter();
  const isControlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("details");
  const [liveValues, setLiveValues] = useState<LiabilityFormValues | null>(null);
  const [submitState, setSubmitState] = useState<{ canSubmit: boolean; loading: boolean }>({
    canSubmit: true,
    loading: false,
  });
  const [autoSaveState, setAutoSaveState] = useState<{ isDirty: boolean; canSave: boolean }>({
    isDirty: false,
    canSave: true,
  });
  const formAutoSaveRef = useRef<LiabilityFormAutoSaveHandle | null>(null);
  // Tracks the freshly-created liability id when an auto-save in ADD mode
  // POSTs a new record. We use this to know we need to router.refresh on close.
  const autoSavedRef = useRef(false);
  const actualOpen = isControlled ? !!open : internalOpen;
  const isEdit = Boolean(editing);

  const handleValuesChange = useCallback((values: LiabilityFormValues) => {
    setLiveValues(values);
  }, []);

  function close() {
    if (autoSavedRef.current) {
      router.refresh();
      autoSavedRef.current = false;
    }
    if (isControlled) onOpenChange?.(false);
    else setInternalOpen(false);
    setActiveTab("details");
  }

  const autoSave = useTabAutoSave({
    isDirty: autoSaveState.isDirty,
    canSave: autoSaveState.canSave,
    saveAsync: async () => {
      const handle = formAutoSaveRef.current;
      if (!handle) return { ok: true };
      return handle.saveAsync();
    },
  });

  return (
    <>
      {!isControlled && (
        <button
          onClick={() => setInternalOpen(true)}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-800 text-gray-300 hover:bg-accent/15 hover:text-accent"
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
        onTabChange={(id) =>
          autoSave.interceptTabChange(id, (next) => setActiveTab(next as TabId))
        }
        tabBarRight={
          <TabAutoSaveIndicator
            saving={autoSave.saving}
            error={autoSave.saveError}
            onDismissError={autoSave.clearSaveError}
          />
        }
        primaryAction={
          activeTab === "details"
            ? {
                label: isEdit ? "Save Changes" : "Add Liability",
                form: "add-liability-form",
                disabled: !submitState.canSubmit || autoSave.saving,
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
        {/* Details: kept mounted across tab switches so the form's in-memory
            state survives — auto-save needs the form alive when the user
            comes back to Details from Amortization. */}
        <div className={activeTab === "details" ? "" : "hidden"}>
          <AddLiabilityForm
            ref={formAutoSaveRef}
            clientId={clientId}
            realEstateAccounts={realEstateAccounts}
            entities={entities}
            familyMembers={familyMembers}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
            mode={isEdit ? "edit" : "create"}
            initial={editing}
            onSuccess={close}
            onValuesChange={handleValuesChange}
            onSubmitStateChange={setSubmitState}
            onAutoSaveStateChange={setAutoSaveState}
            onAutoSaved={() => {
              autoSavedRef.current = true;
            }}
          />
        </div>
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
