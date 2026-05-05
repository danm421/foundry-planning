import type { GiftLedgerYear } from "./gift-ledger";
import { applyUnifiedRateSchedule, beaForYear } from "@/lib/tax/estate";

export interface ProposedGift {
  /** "joint" splits 50/50 to client + spouse before BEA check. */
  grantor: "client" | "spouse" | "joint";
  year: number;
  /** Post-AE for cash gifts; full FMV for asset transfers (engine convention —
   *  AE is not applied to in-kind transfers). 0 for charitable recipients. */
  taxableContribution: number;
}

export interface PerGrantorBreach {
  cumulativeAfter: number;
  beaAtYear: number;
  overage: number;
  /** §2502 marginal tax for this gift only (current-year incremental tax
   *  net of remaining unified credit). */
  estimatedTax: number;
}

export interface ExemptionWarningResult {
  /** True iff any grantor's overage > 0. */
  exceeds: boolean;
  perGrantor: Partial<Record<"client" | "spouse", PerGrantorBreach>>;
}

export function checkExemptionImpact(input: {
  ledger: GiftLedgerYear[];
  proposed: ProposedGift;
  taxInflationRate: number;
}): ExemptionWarningResult {
  const perGrantor: Partial<Record<"client" | "spouse", PerGrantorBreach>> = {};

  for (const g of ["client", "spouse"] as const) {
    const share =
      input.proposed.grantor === "joint"
        ? input.proposed.taxableContribution / 2
        : g === input.proposed.grantor
          ? input.proposed.taxableContribution
          : 0;

    if (share === 0) continue;

    const yearRow = input.ledger.find((r) => r.year === input.proposed.year);
    const grantorState = yearRow?.perGrantor[g];
    const cumulativeBeforeProposed = grantorState?.cumulativeTaxableGifts ?? 0;

    const cumulativeAfter = cumulativeBeforeProposed + share;
    const beaAtYear = beaForYear(input.proposed.year, input.taxInflationRate);
    const overage = Math.max(0, cumulativeAfter - beaAtYear);

    const tentBefore = applyUnifiedRateSchedule(cumulativeBeforeProposed);
    const tentAfter = applyUnifiedRateSchedule(cumulativeAfter);
    const beaCredit = applyUnifiedRateSchedule(beaAtYear);
    const remainingCredit = Math.max(0, beaCredit - tentBefore);
    const estimatedTax = Math.max(0, tentAfter - tentBefore - remainingCredit);

    perGrantor[g] = {
      cumulativeAfter,
      beaAtYear,
      overage,
      estimatedTax,
    };
  }

  const exceeds = (perGrantor.client?.overage ?? 0) > 0 || (perGrantor.spouse?.overage ?? 0) > 0;

  return {
    exceeds,
    perGrantor,
  };
}
