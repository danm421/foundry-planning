import type { ComparisonPlan } from "./build-comparison-plans";
import type { CharityCarryforward } from "@/engine/types";
import type { YearRange } from "./layout-schema";

export interface CharitableFlowRow {
  year: number;
  cashGiftsToCharity: number;
  clutOutflows: number;
  total: number;
}

export function perYearCharitableFlows(
  plan: ComparisonPlan,
  yearRange: YearRange | null,
): CharitableFlowRow[] {
  const charityIds = new Set(
    (plan.tree.externalBeneficiaries ?? [])
      .filter((eb) => eb.kind === "charity")
      .map((eb) => eb.id),
  );

  const giftsByYear = new Map<number, number>();
  for (const g of plan.tree.gifts ?? []) {
    if (!g.recipientExternalBeneficiaryId) continue;
    if (!charityIds.has(g.recipientExternalBeneficiaryId)) continue;
    giftsByYear.set(g.year, (giftsByYear.get(g.year) ?? 0) + g.amount);
  }

  const inRange = (y: number) =>
    !yearRange || (y >= yearRange.start && y <= yearRange.end);

  const rows: CharitableFlowRow[] = [];
  for (const y of plan.result.years) {
    if (!inRange(y.year)) continue;
    const cashGiftsToCharity = giftsByYear.get(y.year) ?? 0;
    const clutOutflows = y.charitableOutflows ?? 0;
    rows.push({
      year: y.year,
      cashGiftsToCharity,
      clutOutflows,
      total: cashGiftsToCharity + clutOutflows,
    });
  }
  return rows;
}

export function charityCarryforwardTotal(
  cf: CharityCarryforward | undefined,
): number {
  if (!cf) return 0;
  const sum = (arr: { amount: number }[]) => arr.reduce((s, e) => s + e.amount, 0);
  return (
    sum(cf.cashPublic) +
    sum(cf.cashPrivate) +
    sum(cf.appreciatedPublic) +
    sum(cf.appreciatedPrivate)
  );
}
