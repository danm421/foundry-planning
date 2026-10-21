import type { QcdSpec } from "@/engine/qcd";
import type { EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

/** The engine spec for a QCD draft, or null when the draft isn't one. A QCD
 *  only ever goes to an external beneficiary (the charity). */
export function qcdSpecFromDraft(d: EstateFlowGift): QcdSpec | null {
  if (d.kind !== "cash-once" && d.kind !== "series") return null;
  if (!d.qcd || d.recipient.kind !== "external_beneficiary") return null;
  const common = {
    accountId: d.qcd.accountId,
    charityId: d.recipient.id,
    mode: d.qcd.amountMode,
  };
  if (d.kind === "series") {
    return {
      ...common,
      startYear: d.startYear,
      endYear: d.endYear,
      amount: d.annualAmount,
      inflationAdjust: d.inflationAdjust,
      seriesId: d.id,
    };
  }
  return {
    ...common,
    startYear: d.year,
    endYear: d.year,
    amount: d.amount,
    inflationAdjust: false,
    sourceGiftId: d.id,
  };
}
