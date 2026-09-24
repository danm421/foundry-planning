import type { gifts } from "@/db/schema";

export interface BundledChildInput {
  clientId: string;
  year: number;
  yearRef: typeof gifts.$inferInsert["yearRef"];
  grantor: typeof gifts.$inferInsert["grantor"];
  accountId: string;
  linkedLiabilityId: string;
  percent: number | null;
  parentGiftId: string;
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
}

/**
 * Values for the liability child row auto-bundled with an asset transfer.
 *
 * The recipient is carried across in FULL — whichever of the three columns the
 * parent names. Copying only `recipientEntityId` cannot satisfy the live CHECK
 * `gifts_recipient_exactly_one` for a person or charity recipient, which rolls
 * the whole transaction back as a generic 500. Mirrors `writeGiftChildren` in
 * `src/lib/scenario/promote-child-writers.ts`, which is the reference impl.
 *
 * `valuationDiscount` is deliberately absent: a liability transfer contributes
 * $0 to the gift ledger and the normalizer skips these rows, so a discount here
 * would be dead data — and a double count against the parent's discount if that
 * ever changed. Do not "fix" this by mirroring the parent.
 */
export function buildBundledChildValues(
  input: BundledChildInput,
): typeof gifts.$inferInsert {
  return {
    clientId: input.clientId,
    year: input.year,
    yearRef: input.yearRef,
    amount: null,
    grantor: input.grantor,
    recipientEntityId: input.recipientEntityId,
    recipientFamilyMemberId: input.recipientFamilyMemberId,
    recipientExternalBeneficiaryId: input.recipientExternalBeneficiaryId,
    accountId: null,
    liabilityId: input.linkedLiabilityId,
    percent: input.percent != null ? String(input.percent) : null,
    parentGiftId: input.parentGiftId,
    useCrummeyPowers: false,
    notes: `Auto-bundled with asset transfer of account ${input.accountId}`,
  };
}
