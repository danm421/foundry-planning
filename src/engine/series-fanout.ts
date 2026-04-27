import type { GiftEvent } from "./types";

export interface GiftSeriesRow {
  id: string;
  grantor: "client" | "spouse";
  recipientEntityId: string;
  startYear: number;
  endYear: number;
  annualAmount: number;
  inflationAdjust: boolean;
  useCrummeyPowers: boolean;
  sourceAccountId?: string;
}

export function fanOutGiftSeries(
  series: GiftSeriesRow,
  ctx: { cpi: number },
): GiftEvent[] {
  if (series.endYear < series.startYear) return [];
  const events: GiftEvent[] = [];
  for (let year = series.startYear; year <= series.endYear; year++) {
    const yearsFromStart = year - series.startYear;
    const amount = series.inflationAdjust
      ? series.annualAmount * Math.pow(1 + ctx.cpi, yearsFromStart)
      : series.annualAmount;
    events.push({
      kind: "cash",
      year,
      amount,
      grantor: series.grantor,
      recipientEntityId: series.recipientEntityId,
      sourceAccountId: series.sourceAccountId,
      useCrummeyPowers: series.useCrummeyPowers,
      seriesId: series.id,
    });
  }
  return events;
}
