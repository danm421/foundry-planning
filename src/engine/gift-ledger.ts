import type { Gift, GiftEvent } from "./types";
import { applyUnifiedRateSchedule, beaForYear } from "@/lib/tax/estate";

export interface GrantorYearState {
  /** Taxable gifts this year only (after annual exclusion + charitable). */
  taxableGiftsThisYear: number;
  /** Running total including priorTaxableGifts seed. */
  cumulativeTaxableGifts: number;
  /** applyUnifiedRateSchedule(cumulativeTaxableGifts). */
  creditUsed: number;
  /** §2502 marginal current-year tax. 0 until cumulative > BEA(year). */
  giftTaxThisYear: number;
  cumulativeGiftTax: number;
}

export interface GiftLedgerYear {
  year: number;
  giftsGiven: number;
  taxableGiftsGiven: number;
  perGrantor: {
    client: GrantorYearState;
    spouse?: GrantorYearState;
  };
  totalGiftTax: number;
}

export interface GiftLedgerInput {
  planStartYear: number;
  planEndYear: number;
  hasSpouse: boolean;
  priorTaxableGifts: { client: number; spouse: number };
  gifts: Gift[];
  giftEvents: GiftEvent[];
  externalBeneficiaryKindById: Map<string, "charity" | "individual">;
  annualExclusionsByYear: Record<number, number>;
  taxInflationRate: number;
  accountValueAtYear: (accountId: string, year: number) => number;
}

type Grantor = "client" | "spouse";

function emptyState(): GrantorYearState {
  return {
    taxableGiftsThisYear: 0,
    cumulativeTaxableGifts: 0,
    creditUsed: 0,
    giftTaxThisYear: 0,
    cumulativeGiftTax: 0,
  };
}

export function computeGiftLedger(input: GiftLedgerInput): GiftLedgerYear[] {
  const result: GiftLedgerYear[] = [];

  let prevClient: GrantorYearState = {
    ...emptyState(),
    cumulativeTaxableGifts: input.priorTaxableGifts.client,
    creditUsed: applyUnifiedRateSchedule(input.priorTaxableGifts.client),
  };
  let prevSpouse: GrantorYearState | undefined = input.hasSpouse
    ? {
        ...emptyState(),
        cumulativeTaxableGifts: input.priorTaxableGifts.spouse,
        creditUsed: applyUnifiedRateSchedule(input.priorTaxableGifts.spouse),
      }
    : undefined;

  for (let year = input.planStartYear; year <= input.planEndYear; year++) {
    const client = stepGrantor("client", year, prevClient, input);
    const spouse = input.hasSpouse && prevSpouse
      ? stepGrantor("spouse", year, prevSpouse, input)
      : undefined;

    const taxableGiftsGiven = client.taxableGiftsThisYear + (spouse?.taxableGiftsThisYear ?? 0);
    const totalGiftTax = client.giftTaxThisYear + (spouse?.giftTaxThisYear ?? 0);

    result.push({
      year,
      giftsGiven: 0,
      taxableGiftsGiven,
      perGrantor: { client, ...(spouse ? { spouse } : {}) },
      totalGiftTax,
    });

    prevClient = client;
    if (spouse) prevSpouse = spouse;
  }

  return result;
}

function stepGrantor(
  _grantor: Grantor,
  _year: number,
  prev: GrantorYearState,
  _input: GiftLedgerInput,
): GrantorYearState {
  return {
    taxableGiftsThisYear: 0,
    cumulativeTaxableGifts: prev.cumulativeTaxableGifts,
    creditUsed: prev.creditUsed,
    giftTaxThisYear: 0,
    cumulativeGiftTax: prev.cumulativeGiftTax,
  };
}

// Suppress unused-import warning until later tasks consume `beaForYear`.
void beaForYear;
