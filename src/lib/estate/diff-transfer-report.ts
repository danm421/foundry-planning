// Comparison math for the Transfer Detail report. Recipients already carry a
// scenario-stable key (`recipientKind|recipientId`) from
// buildEstateTransferReportData, so no key synthesis is needed here.
//
// Every delta is `right - left`, matching diff-estate-tax.
import {
  estateAtDeathOf,
  type DeathSectionData,
  type EstateTransferReportData,
} from "@/lib/estate/transfer-report";
import { diffAmountsByKey, type LineDiff } from "@/lib/estate/diff-estate-tax";

export interface DeathSectionDiff {
  /** The header's "Estate at death": assets PLUS the debt assumed. Distinct
   *  from `assetEstateValue`, which is the asset leg alone — the two diverge
   *  whenever a scenario changes the debt that rides through the death event. */
  estateAtDeath: number;
  assetEstateValue: number;
  taxableEstate: number;
  grossEstate: number;
  recipients: Map<string, LineDiff>;
}

export interface TransferReportDiff {
  firstDeath: DeathSectionDiff | null;
  secondDeath: DeathSectionDiff | null;
  aggregateRecipientTotals: Map<string, LineDiff>;
}

function diffTotalsByKey(
  left: Array<{ key: string; total: number }>,
  right: Array<{ key: string; total: number }>,
): Map<string, LineDiff> {
  const l = new Map(left.map((x) => [x.key, x.total]));
  const r = new Map(right.map((x) => [x.key, x.total]));
  return diffAmountsByKey(l, r);
}

function diffSection(
  left: DeathSectionData | null,
  right: DeathSectionData | null,
): DeathSectionDiff | null {
  if (!left && !right) return null;
  const lv = left?.assetEstateValue ?? 0;
  const rv = right?.assetEstateValue ?? 0;
  return {
    estateAtDeath:
      (right ? estateAtDeathOf(right) : 0) - (left ? estateAtDeathOf(left) : 0),
    assetEstateValue: rv - lv,
    taxableEstate: (right?.taxableEstate ?? 0) - (left?.taxableEstate ?? 0),
    grossEstate: (right?.grossEstate ?? 0) - (left?.grossEstate ?? 0),
    recipients: diffTotalsByKey(left?.recipients ?? [], right?.recipients ?? []),
  };
}

export function diffTransferReport(
  left: EstateTransferReportData,
  right: EstateTransferReportData,
): TransferReportDiff {
  return {
    firstDeath: diffSection(left.firstDeath, right.firstDeath),
    secondDeath: diffSection(left.secondDeath, right.secondDeath),
    aggregateRecipientTotals: diffTotalsByKey(
      left.aggregateRecipientTotals,
      right.aggregateRecipientTotals,
    ),
  };
}
