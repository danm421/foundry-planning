"use client";

import type {
  InsurancePanelAccount,
  InsurancePanelEntity,
  InsurancePanelFamilyMember,
  InsurancePanelExternal,
} from "./insurance-panel";

export interface InsurancePolicyDialogProps {
  clientId: string;
  accounts: InsurancePanelAccount[];
  entities: InsurancePanelEntity[];
  familyMembers: InsurancePanelFamilyMember[];
  externalBeneficiaries: InsurancePanelExternal[];
  mode: "create" | "edit";
  policyId?: string;
  onClose: () => void;
}

export default function InsurancePolicyDialog(props: InsurancePolicyDialogProps) {
  // NOTE: Placeholder stub — replaced by Task 21 with the real dialog.
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={props.onClose}
    >
      <div
        className="rounded-lg border border-gray-700 bg-gray-900 p-6 text-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">
          {props.mode === "create" ? "Add policy" : "Edit policy"}
        </h2>
        <p className="mt-2 text-sm text-gray-400">Dialog UI coming in Task 21.</p>
        <button
          type="button"
          className="mt-4 rounded-md bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600"
          onClick={props.onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
