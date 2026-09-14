"use client";

import { selectClassName } from "@/components/forms/input-styles";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { OWNER_HINT_REASON } from "./owner-cell";
import { CO_CLIENT_LABEL } from "@/lib/owner-labels";
import type { AccountOwner } from "@/engine/ownership";
import type { OwnerMatchFamilyMember } from "@/lib/imports/owner-match";
import {
  buildOwnerOptions,
  groupOwnerOptions,
  optionValueToOwners,
  ownersToOptionValue,
  type OwnerEntityOption,
} from "@/lib/statement-chat/owner-options";

export interface OwnerCellEditProps {
  /** The row's current ownership, when it has any. */
  owners?: AccountOwner[];
  /** The registration name the statement printed, verbatim. */
  hint?: string;
  /** Drives whether a joint option is offered — see `buildOwnerOptions`. */
  subType?: string | null;
  /** A 529 is attributed to its beneficiary and gets NO account_owners rows. */
  is529?: boolean;
  family: OwnerMatchFamilyMember[];
  entities: OwnerEntityOption[];
  /** Fires once, with the picked owner set. Never with an empty array. */
  onDone: (owners: AccountOwner[]) => void;
}

/**
 * The Owner cell's edit view: who on THIS PLAN owns the account.
 *
 * It used to offer three words — Client, Co-client, Joint — which is the coarse
 * `ExtractedAccount.owner` enum the extractor guesses at a household role no
 * statement prints. Three problems with that, all of which this replaces:
 * the words are not the names the advisor is reading off the statement; a child,
 * a trust, or anybody else on the plan has no enum value at all and so could not
 * be chosen; and the enum only becomes real people at commit time, via
 * `synthesizeAccountOwners`, so what the advisor picked and what got written
 * were two different vocabularies.
 *
 * This writes `owners[]` directly — the same shape `OwnershipEditor` produces
 * and `commit/accounts.ts` persists verbatim through `writeImportedOwners`. The
 * coarse enum is deliberately left untouched: it stays the extractor's record of
 * what the statement said, and it is still the fallback if the owner set fails
 * tenant validation at commit.
 *
 * ONE field, so it writes on change and needs no local draft state and no
 * "Done" button — the opposite of `account-type-cell.tsx`, whose two selects
 * must move together or half a reclassification lands.
 *
 * There is no way back to "unknown": the placeholder option is disabled. An
 * owner the advisor has stated is better evidence than the guess it replaced,
 * and clearing it would only restore the guess.
 *
 * The registration name sits on the canvas rather than in a `FieldTooltip`
 * because it is not a how-it-works explanation — it is the EVIDENCE the advisor
 * decides on. The EXPLANATION of why it is only an assumption does go in a
 * tooltip, which is legal here and is not in the read cell: an editor replaces
 * the cell's click-to-edit button rather than rendering inside it (fix round 1,
 * Important 1).
 */
export default function OwnerCellEdit({
  owners,
  hint,
  subType,
  is529,
  family,
  entities,
  onDone,
}: OwnerCellEditProps) {
  // `commit/accounts.ts` writes no `account_owners` rows for a 529 at all — it
  // is attributed to its designated beneficiary instead. Offering a picker here
  // would be a control whose every pick is discarded on the way to the
  // database, which reads as a dead dropdown. Say so instead.
  if (is529) {
    return (
      <div className="flex flex-col gap-1.5 text-xs text-ink-3">
        <span className="text-ink">Beneficiary-owned</span>
        <span>A 529 is attributed to its beneficiary — set that on the account.</span>
      </div>
    );
  }
  const options = buildOwnerOptions(family, entities, {
    subType,
    coClientLabel: CO_CLIENT_LABEL,
  });
  const current = ownersToOptionValue(owners, family);

  return (
    <div className="flex flex-col gap-1.5">
      <select
        aria-label="Owner"
        value={current ?? ""}
        className={selectClassName}
        onChange={(e) => {
          const next = optionValueToOwners(e.target.value, family);
          // `null` means the roster can no longer satisfy the pick (a joint
          // option on a household whose co-client was removed between render
          // and click). Writing nothing beats writing a set that fails
          // `validateOwnersShape` and silently falls back to the coarse enum.
          if (next) onDone(next);
        }}
      >
        <option value="" disabled>
          {options.length === 0 ? "Nobody on this plan yet" : "Select..."}
        </option>
        {groupOwnerOptions(options).map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {hint ? (
        <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
          Statement reads “{hint}”
          <FieldTooltip text={OWNER_HINT_REASON} />
        </span>
      ) : null}
    </div>
  );
}
