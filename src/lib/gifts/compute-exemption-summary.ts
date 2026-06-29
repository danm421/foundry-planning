import type { EntitySummary, Gift, GiftEvent } from "@/engine/types";
import type { GiftLedgerYear } from "@/engine/gift-ledger";
import { beaForYear } from "@/lib/tax/estate";
import { toCanonicalGifts, treatCanonicalGift } from "./normalize-gifts";

export interface ExemptionSummary {
  perGrantor: {
    client: { used: number; total: number };
    spouse?: { used: number; total: number };
  };
  perTrust: Record<string, { client: number; spouse: number }>;
}

export interface ExemptionSummaryInput {
  giftLedger: GiftLedgerYear[];
  gifts: Gift[];
  giftEvents: GiftEvent[];
  entities: EntitySummary[];
  annualExclusionsByYear: Record<number, number>;
  taxInflationRate: number;
  lifetimeExemptionCap?: number | null;
  hasSpouse?: boolean;
}

export function computeExemptionSummary(input: ExemptionSummaryInput): ExemptionSummary {
  const last = input.giftLedger[input.giftLedger.length - 1];
  const year = last?.year ?? 0;
  const total = beaForYear(year, input.taxInflationRate, input.lifetimeExemptionCap);

  const perGrantor: ExemptionSummary["perGrantor"] = {
    client: { used: last?.perGrantor.client.cumulativeTaxableGifts ?? 0, total },
  };
  if (input.hasSpouse && last?.perGrantor.spouse) {
    perGrantor.spouse = { used: last.perGrantor.spouse.cumulativeTaxableGifts, total };
  }

  const perTrust: ExemptionSummary["perTrust"] = {};
  const canonical = toCanonicalGifts(input.gifts, input.giftEvents, {
    entities: input.entities,
    accountValueAtYear: () => 0,
  });
  for (const cg of canonical) {
    if (!cg.recipientEntityId) continue;
    const used = treatCanonicalGift(cg, input.annualExclusionsByYear[cg.year] ?? 0).lifetimeUsed;
    if (used <= 0) continue;
    const slot = (perTrust[cg.recipientEntityId] ??= { client: 0, spouse: 0 });
    slot[cg.grantor] += used;
  }

  return { perGrantor, perTrust };
}
