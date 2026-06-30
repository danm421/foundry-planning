import type { GiftEvent } from "./types";

export interface GiftSeriesRow {
  id: string;
  grantor: "client" | "spouse" | "joint";
  recipientEntityId?: string;
  recipientFamilyMemberId?: string;
  recipientExternalBeneficiaryId?: string;
  startYear: number;
  endYear: number;
  annualAmount: number;
  amountMode: "fixed" | "annual_exclusion";
  inflationAdjust: boolean;
  useCrummeyPowers: boolean;
  sourceAccountId?: string;
}

export function fanOutGiftSeries(
  series: GiftSeriesRow,
  ctx: { cpi: number; exclusionByYear?: Record<number, number> },
): GiftEvent[] {
  if (series.endYear < series.startYear) return [];
  const grantorCount = series.grantor === "joint" ? 2 : 1;
  const events: GiftEvent[] = [];
  for (let year = series.startYear; year <= series.endYear; year++) {
    let amount: number;
    if (series.amountMode === "annual_exclusion") {
      // Dynamic: each year's gift = that year's indexed §2503(b) exclusion × grantors.
      amount = (ctx.exclusionByYear?.[year] ?? 0) * grantorCount;
    } else {
      const yearsFromStart = year - series.startYear;
      amount = series.inflationAdjust
        ? series.annualAmount * Math.pow(1 + ctx.cpi, yearsFromStart)
        : series.annualAmount;
    }
    events.push({
      kind: "cash",
      year,
      amount,
      grantor: series.grantor,
      recipientEntityId: series.recipientEntityId,
      recipientFamilyMemberId: series.recipientFamilyMemberId,
      recipientExternalBeneficiaryId: series.recipientExternalBeneficiaryId,
      sourceAccountId: series.sourceAccountId,
      useCrummeyPowers: series.useCrummeyPowers,
      seriesId: series.id,
    });
  }
  return events;
}
