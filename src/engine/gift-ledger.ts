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
      giftsGiven: sumGrossGifts(year, input),
      taxableGiftsGiven,
      perGrantor: { client, ...(spouse ? { spouse } : {}) },
      totalGiftTax,
    });

    prevClient = client;
    if (spouse) prevSpouse = spouse;
  }

  return result;
}

function isCharitableGift(
  g: Gift,
  externalBeneficiaryKindById: Map<string, "charity" | "individual">,
): boolean {
  return g.recipientExternalBeneficiaryId != null &&
    externalBeneficiaryKindById.get(g.recipientExternalBeneficiaryId) === "charity";
}

function sumLegacyCashGifts(
  grantor: Grantor,
  year: number,
  input: GiftLedgerInput,
): number {
  const exclusion = input.annualExclusionsByYear[year] ?? 0;
  let total = 0;
  for (const g of input.gifts) {
    if (g.year !== year) continue;
    if (isCharitableGift(g, input.externalBeneficiaryKindById)) continue;
    if (g.grantor === grantor) {
      total += Math.max(0, g.amount - exclusion);
    } else if (g.grantor === "joint") {
      total += Math.max(0, g.amount / 2 - exclusion);
    }
  }
  return total;
}

function sumGrossGifts(year: number, input: GiftLedgerInput): number {
  let total = 0;
  for (const g of input.gifts) {
    if (g.year === year) total += g.amount;
  }
  for (const ev of input.giftEvents) {
    if (ev.year !== year) continue;
    if (ev.kind === "cash") {
      if (ev.seriesId == null) continue;
      total += ev.amount;
    } else if (ev.kind === "asset") {
      total += ev.amountOverride != null
        ? ev.amountOverride
        : input.accountValueAtYear(ev.accountId, ev.year) * ev.percent;
    }
  }
  return total;
}

function recipientIsCharity(
  ev: GiftEvent,
  externalBeneficiaryKindById: Map<string, "charity" | "individual">,
): boolean {
  const id = (ev as { recipientExternalBeneficiaryId?: string }).recipientExternalBeneficiaryId;
  if (id) {
    return externalBeneficiaryKindById.get(id) === "charity";
  }
  return false;
}

function sumGiftEvents(
  grantor: Grantor,
  year: number,
  input: GiftLedgerInput,
): number {
  const exclusion = input.annualExclusionsByYear[year] ?? 0;
  let total = 0;
  for (const ev of input.giftEvents) {
    if (ev.year !== year) continue;
    if (ev.grantor !== grantor) continue;
    if (recipientIsCharity(ev, input.externalBeneficiaryKindById)) continue;

    if (ev.kind === "cash") {
      // One-time cash gifts come through legacy `gifts` array; only series fan-outs here.
      if (ev.seriesId == null) continue;
      total += Math.max(0, ev.amount - exclusion);
    } else if (ev.kind === "asset") {
      const value = ev.amountOverride != null
        ? ev.amountOverride
        : input.accountValueAtYear(ev.accountId, ev.year) * ev.percent;
      total += value;
    }
    // Liability transfers: 0 contribution.
  }
  return total;
}

function stepGrantor(
  grantor: Grantor,
  year: number,
  prev: GrantorYearState,
  input: GiftLedgerInput,
): GrantorYearState {
  const taxableGiftsThisYear =
    sumLegacyCashGifts(grantor, year, input) +
    sumGiftEvents(grantor, year, input);

  const cumulativeBefore = prev.cumulativeTaxableGifts;
  const cumulativeAfter = cumulativeBefore + taxableGiftsThisYear;

  const tentativeTaxOnAfter = applyUnifiedRateSchedule(cumulativeAfter);
  const tentativeTaxOnBefore = applyUnifiedRateSchedule(cumulativeBefore);
  const currentYearTentTax = tentativeTaxOnAfter - tentativeTaxOnBefore;

  const beaCredit = applyUnifiedRateSchedule(beaForYear(year, input.taxInflationRate));
  const remainingCredit = Math.max(0, beaCredit - tentativeTaxOnBefore);
  const giftTaxThisYear = Math.max(0, currentYearTentTax - remainingCredit);

  return {
    taxableGiftsThisYear,
    cumulativeTaxableGifts: cumulativeAfter,
    creditUsed: tentativeTaxOnAfter,
    giftTaxThisYear,
    cumulativeGiftTax: prev.cumulativeGiftTax + giftTaxThisYear,
  };
}
