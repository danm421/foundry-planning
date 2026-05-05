import type { GiftLedgerYear } from "@/engine/gift-ledger";
import type { Gift, GiftEvent } from "@/engine/types";

export interface DeriveRecipientBreachesInput {
  ledger: GiftLedgerYear[];
  gifts: Gift[];
  giftEvents: GiftEvent[];
}

function recipientKey(g: Gift | GiftEvent): string | null {
  if ("recipientEntityId" in g && g.recipientEntityId) return `entity:${g.recipientEntityId}`;
  if ("recipientFamilyMemberId" in g && g.recipientFamilyMemberId) return `family:${g.recipientFamilyMemberId}`;
  if ("recipientExternalBeneficiaryId" in g && g.recipientExternalBeneficiaryId) return `external:${g.recipientExternalBeneficiaryId}`;
  return null;
}

/**
 * Map keys:
 *   `entity:<id>`   for trust / entity recipients
 *   `family:<id>`   for family-member recipients
 *   `external:<id>` for external-beneficiary recipients
 * Value: true if the recipient receives any gift in a year where
 *   ledger[year].totalGiftTax > 0.
 */
export function deriveRecipientBreaches(
  input: DeriveRecipientBreachesInput,
): Map<string, boolean> {
  const breachYears = new Set<number>();
  for (const ly of input.ledger) {
    if (ly.totalGiftTax > 0) breachYears.add(ly.year);
  }
  const out = new Map<string, boolean>();
  for (const g of input.gifts) {
    const k = recipientKey(g);
    if (k && breachYears.has(g.year)) out.set(k, true);
  }
  for (const ev of input.giftEvents) {
    const k = recipientKey(ev);
    if (k && breachYears.has(ev.year)) out.set(k, true);
  }
  return out;
}
