"use client";

import { fieldLabelClassName } from "./input-styles";
import { RecipientSelect, rowFieldBase } from "./bequest-recipient-list";
import type {
  WillGrantor,
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
  WillsPanelPrimary,
  WillRecipientKind,
} from "@/components/wills-panel";

export interface DollarRecipientRow {
  recipientKind: WillRecipientKind;
  recipientId: string | null;
  /** NaN while the amount field is blank or not a number. */
  amount: number;
  sortOrder: number;
}

interface DollarRecipientListProps {
  grantor: WillGrantor;
  rows: DollarRecipientRow[];
  /** What each row's amount field shows; parallel to `rows`. Used when
   *  "Same amount to each" is off. */
  amountTexts: string[];
  /** On: the rows carry no amount field of their own; one field above drives them. */
  sameAmount: boolean;
  onPickRecipient: (
    idx: number,
    fields: { recipientKind: WillRecipientKind; recipientId: string | null },
  ) => void;
  onAmountText: (idx: number, text: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
  primary: WillsPanelPrimary;
  familyMembers: WillsPanelFamilyMember[];
  externalBeneficiaries: WillsPanelExternal[];
  entities: WillsPanelEntity[];
}

/** The recipient rows of a dollar gift: who, and (unless every row shares one
 *  amount) how many dollars. */
export default function DollarRecipientList({
  grantor,
  rows,
  amountTexts,
  sameAmount,
  onPickRecipient,
  onAmountText,
  onAdd,
  onRemove,
  primary,
  familyMembers,
  externalBeneficiaries,
  entities,
}: DollarRecipientListProps) {
  return (
    <div>
      <span className={fieldLabelClassName}>Recipients</span>
      <ul className="space-y-2">
        {rows.map((r, idx) => (
          <li key={idx} className="flex items-center gap-2">
            <RecipientSelect
              ariaLabel={`Recipient ${idx + 1}`}
              value={r}
              onChange={(fields) => onPickRecipient(idx, fields)}
              grantor={grantor}
              primary={primary}
              familyMembers={familyMembers}
              externalBeneficiaries={externalBeneficiaries}
              entities={entities}
              showExternal
            />
            {!sameAmount && (
              <>
                <span aria-hidden className="text-xs text-ink-3">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Amount ${idx + 1}`}
                  value={amountTexts[idx] ?? ""}
                  onChange={(e) => onAmountText(idx, e.target.value)}
                  className={rowFieldBase + " tabular w-28 text-right"}
                />
              </>
            )}
            <button
              type="button"
              aria-label={`Remove recipient ${idx + 1}`}
              onClick={() => onRemove(idx)}
              className="rounded px-1 text-xs text-ink-3 hover:bg-card-hover hover:text-ink"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onAdd} className="mt-2 text-xs text-accent hover:text-accent-ink">
        + Add recipient
      </button>
    </div>
  );
}
