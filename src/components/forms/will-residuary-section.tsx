"use client";

import BequestRecipientList, {
  type BequestRecipient,
} from "@/components/forms/bequest-recipient-list";
import type {
  WillGrantor,
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
  WillsPanelPrimary,
  WillsPanelRecipient,
} from "@/components/wills-panel";

export interface WillResiduarySectionProps {
  rows: WillsPanelRecipient[];
  onChange?: (rows: WillsPanelRecipient[]) => void;
  grantor: WillGrantor;
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

function HelpIcon({ label }: { label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      tabIndex={0}
      className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-600 text-[10px] font-semibold text-gray-400 hover:border-gray-400 hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-accent/40"
    >
      ?
    </span>
  );
}

export default function WillResiduarySection({
  rows,
  onChange: onChangeProp,
  grantor,
  primary,
  familyMembers,
  externalBeneficiaries,
  entities,
  saving,
}: WillResiduarySectionProps) {
  const canEdit = onChangeProp !== undefined;
  const primaryRows = tierRows(rows, "primary");
  const contingentRows = tierRows(rows, "contingent");
  const isEmpty = rows.length === 0;
  // The grantor's spouse-survival branch only exists when there is a spouse
  // on file at all. `WillsPanel` never renders the spouse's will when
  // `primary.spouseName` is null, so checking `spouseName` is sufficient
  // regardless of which grantor we're rendering.
  const hasSpouse = primary.spouseName != null;

  function emit(
    nextPrimary: BequestRecipient[],
    nextContingent: BequestRecipient[],
  ) {
    if (!onChangeProp) return;
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
    onChangeProp(combined);
  }

  const column = (
    label: string,
    tooltip: string,
    body: React.ReactNode,
  ) => (
    <div className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
      <div className="mb-2 flex items-center gap-1.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-300">
          {label}
        </h4>
        <HelpIcon label={tooltip} />
      </div>
      {body}
    </div>
  );

  return (
    <div className="mt-6 rounded-md border border-gray-800 bg-gray-900/30 p-4">
      <div className="mb-3 flex items-center gap-1.5">
        <h3 className="text-sm font-medium text-gray-300">Remainder estate</h3>
        <HelpIcon label="Where the residue of the estate goes after specific bequests have been distributed." />
      </div>
      {isEmpty && (
        <p className="mb-3 text-xs text-gray-400">
          No remainder clause specified. Residual assets are distributed by the
          default order — surviving spouse, then children, then other heirs.
        </p>
      )}
      <fieldset disabled={saving || !canEdit}>
        {hasSpouse ? (
          <div className="grid gap-3 md:grid-cols-2">
            {column(
              "Primary",
              "Used if the spouse survives the grantor.",
              <BequestRecipientList
                mode="residuary"
                grantor={grantor}
                rows={primaryRows}
                onChange={(next) => emit(next, contingentRows)}
                primary={primary}
                familyMembers={familyMembers}
                externalBeneficiaries={externalBeneficiaries}
                entities={entities}
              />,
            )}
            {column(
              "Contingent",
              "Used if the spouse predeceases the grantor.",
              <BequestRecipientList
                mode="residuary"
                grantor={grantor}
                rows={contingentRows}
                onChange={(next) => emit(primaryRows, next)}
                primary={primary}
                familyMembers={familyMembers}
                externalBeneficiaries={externalBeneficiaries}
                entities={entities}
              />,
            )}
          </div>
        ) : (
          <BequestRecipientList
            mode="residuary"
            grantor={grantor}
            rows={primaryRows}
            onChange={(next) => emit(next, contingentRows)}
            primary={primary}
            familyMembers={familyMembers}
            externalBeneficiaries={externalBeneficiaries}
            entities={entities}
          />
        )}
      </fieldset>
    </div>
  );
}
