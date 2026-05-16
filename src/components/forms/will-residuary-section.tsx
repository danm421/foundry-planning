"use client";

import BequestRecipientList, {
  type BequestRecipient,
} from "@/components/forms/bequest-recipient-list";
import type {
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
  WillsPanelPrimary,
  WillsPanelRecipient,
} from "@/components/wills-panel";

export interface WillResiduarySectionProps {
  /** All residuary recipients across both tiers. */
  rows: WillsPanelRecipient[];
  onChange: (rows: WillsPanelRecipient[]) => void;
  primary: WillsPanelPrimary;
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
  saving: boolean;
}

function tierRows(
  rows: WillsPanelRecipient[],
  tier: "primary" | "contingent",
): BequestRecipient[] {
  return rows
    .filter((r) => (r.tier ?? "primary") === tier)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((r) => ({
      recipientKind: r.recipientKind,
      recipientId: r.recipientId,
      percentage: r.percentage,
      sortOrder: r.sortOrder,
    }));
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
  const primaryRows = tierRows(rows, "primary");
  const contingentRows = tierRows(rows, "contingent");
  const isEmpty = rows.length === 0;
  const hasSpouse = primary.spouseName != null;

  function emit(
    nextPrimary: BequestRecipient[],
    nextContingent: BequestRecipient[],
  ) {
    const combined: WillsPanelRecipient[] = [
      ...nextPrimary.map((r, i) => ({
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        tier: "primary" as const,
        percentage: r.percentage,
        sortOrder: i,
      })),
      ...nextContingent.map((r, i) => ({
        recipientKind: r.recipientKind,
        recipientId: r.recipientId,
        tier: "contingent" as const,
        percentage: r.percentage,
        sortOrder: nextPrimary.length + i,
      })),
    ];
    onChange(combined);
  }

  return (
    <div className="mt-6 rounded-md border border-gray-800 bg-gray-900/30 p-4">
      <h3 className="mb-1 text-sm font-medium text-gray-300">
        Remainder estate — where does what&apos;s left go?
      </h3>
      {isEmpty && (
        <p className="mb-3 text-xs text-gray-400">
          No remainder clause specified. Residual assets (after specific
          bequests) are distributed by the default order — surviving spouse,
          then children, then other heirs.
        </p>
      )}
      <fieldset disabled={saving}>
        {hasSpouse && (
          <p className="mb-1 text-xs font-medium text-gray-400">
            Primary — if spouse survives
          </p>
        )}
        <BequestRecipientList
          mode="residuary"
          rows={primaryRows}
          onChange={(next) => emit(next, contingentRows)}
          primary={primary}
          familyMembers={familyMembers}
          externalBeneficiaries={externalBeneficiaries}
          entities={entities}
        />
        {hasSpouse && (
          <>
            <p className="mb-1 mt-4 text-xs font-medium text-gray-400">
              Contingent — if spouse predeceased
            </p>
            <BequestRecipientList
              mode="residuary"
              rows={contingentRows}
              onChange={(next) => emit(primaryRows, next)}
              primary={primary}
              familyMembers={familyMembers}
              externalBeneficiaries={externalBeneficiaries}
              entities={entities}
            />
          </>
        )}
      </fieldset>
    </div>
  );
}
