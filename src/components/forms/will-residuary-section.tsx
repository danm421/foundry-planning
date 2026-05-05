"use client";

import BequestRecipientList, {
  type BequestRecipient,
} from "@/components/forms/bequest-recipient-list";
import type {
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
  WillsPanelPrimary,
} from "@/components/wills-panel";

export interface WillResiduarySectionProps {
  rows: BequestRecipient[];
  onChange: (rows: BequestRecipient[]) => void;
  primary: WillsPanelPrimary;
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  saving: boolean;
}

export default function WillResiduarySection({
  rows,
  onChange,
  primary,
  familyMembers,
  externalBeneficiaries,
  entities,
  saving,
}: WillResiduarySectionProps) {
  const isEmpty = rows.length === 0;

  return (
    <div className="mt-6 rounded-md border border-gray-800 bg-gray-900/30 p-4">
      <h3 className="mb-1 text-sm font-medium text-gray-300">
        Residuary clause — where does what&apos;s left go?
      </h3>
      {isEmpty && (
        <p className="mb-3 text-xs text-gray-400">
          No residuary specified. Residual assets (after specific bequests) are
          distributed pro-rata to non-spouse heirs; taxes and expenses are
          allocated pro-rata across all recipients.
        </p>
      )}
      <fieldset disabled={saving}>
        <BequestRecipientList
          mode="residuary"
          rows={rows}
          onChange={onChange}
          primary={primary}
          familyMembers={familyMembers}
          externalBeneficiaries={externalBeneficiaries}
          entities={entities}
        />
      </fieldset>
    </div>
  );
}
