"use client";

import { forwardRef, useImperativeHandle } from "react";
import type { SaveResult } from "@/lib/use-tab-auto-save";
import type { ClientMilestones } from "@/lib/milestones";
import type { AccountOwner } from "@/engine/ownership";

export interface NoteReceivableFormInitial {
  id: string;
  name: string;
  faceValue: number;
  basis: number;
  asOfBalance?: number;
  balanceAsOfMonth?: number;
  balanceAsOfYear?: number;
  interestRate: number;
  paymentType: "amortizing" | "interest_only_balloon";
  monthlyPayment?: number;
  startYear: number;
  startMonth: number;
  termMonths: number;
  linkedTrustEntityId?: string | null;
  owners: AccountOwner[];
  extraPayments: Array<{
    year: number;
    type: "per_payment" | "lump_sum";
    amount: number;
  }>;
}

export interface AddNoteReceivableFormProps {
  clientId: string;
  entities?: { id: string; name: string }[];
  familyMembers?: {
    id: string;
    role: "client" | "spouse" | "child" | "other";
    firstName: string;
  }[];
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
  mode?: "create" | "edit";
  initial?: NoteReceivableFormInitial;
  onSuccess?: () => void;
  onSubmitStateChange?: (state: { canSubmit: boolean; loading: boolean }) => void;
  onAutoSaveStateChange?: (state: { isDirty: boolean; canSave: boolean }) => void;
  onAutoSaved?: (recordId: string) => void;
}

export interface NoteReceivableFormAutoSaveHandle {
  saveAsync: () => Promise<SaveResult & { recordId?: string }>;
}

const AddNoteReceivableForm = forwardRef<
  NoteReceivableFormAutoSaveHandle,
  AddNoteReceivableFormProps
>(function AddNoteReceivableForm(_props, ref) {
  useImperativeHandle(
    ref,
    () => ({
      saveAsync: async () => ({
        ok: false,
        error: "AddNoteReceivableForm not implemented",
      }),
    }),
    [],
  );

  return (
    <div className="rounded-md border border-dashed border-gray-600 p-6 text-sm text-gray-400">
      Note Receivable form — skeleton (Task 4.1). Details, Amortization, and
      Extra Payments tabs are implemented in Tasks 4.3–4.5.
    </div>
  );
});

export default AddNoteReceivableForm;
