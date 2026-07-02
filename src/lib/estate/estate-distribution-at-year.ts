import type { ProjectionResult, ClientData } from "@/engine";
import { collectCharityExternalBeneficiaryIds } from "./charity-recipients";
import { buildEstateTransferReportData, type RecipientGroup } from "./transfer-report";
import { summarizeHousehold } from "@/lib/presentations/pages/estate-summary/aggregate";

export interface EstateDistribution {
  year: number;
  toHeirs: number;
  taxesAndExpenses: number;
  toCharity: number;
  isEmpty: boolean;
}

/**
 * The single source of truth for "estate distribution as of year Y". Reads the
 * engine's per-year hypothetical (anchored to the real first death for Y past
 * that death; both-die-in-Y before it) via the transfer report, then rolls it
 * up bottom-up. Every estate surface consumes this so numbers can't diverge.
 */
export function estateDistributionAtYear(args: {
  projection: ProjectionResult;
  year: number;
  clientData: ClientData;
  ownerNames: { clientName: string; spouseName: string | null };
  ordering?: "primaryFirst" | "spouseFirst"; // only consulted for years < first death
}): EstateDistribution {
  const report = buildEstateTransferReportData({
    projection: args.projection,
    asOf: { kind: "year", year: args.year },
    ordering: args.ordering ?? "primaryFirst",
    clientData: args.clientData,
    ownerNames: args.ownerNames,
  });
  if (report.isEmpty) {
    return { year: args.year, toHeirs: 0, taxesAndExpenses: 0, toCharity: 0, isEmpty: true };
  }
  const h = summarizeHousehold(report);

  // Split the "to charity" bucket out of net-to-heirs. `netToHeirs` sums every
  // non-spouse recipient's net inheritance (`aggregateRecipientTotals[].total`,
  // itself the per-death `netTotal` summed per recipient — see transfer-report
  // buildAggregateTotals), so charity is currently folded into it.
  //
  // Charity is resolved exactly as the existing estate-comparison chart does
  // (shared `collectCharityExternalBeneficiaryIds` in ./charity-recipients): an
  // external-beneficiary recipient counts as charity only when its backing
  // `clientData.externalBeneficiaries` entry has `kind === "charity"`. Matching
  // that predicate keeps this builder reconcilable with the chart when the chart
  // migrates onto it. Because charity recipients are summed from the same
  // per-death `netTotal` that feeds `aggregateRecipientTotals[].total`, the
  // subtraction `toHeirs = netToHeirs − toCharity` is exact by construction.
  const charityIds = collectCharityExternalBeneficiaryIds(args.clientData);
  const isCharity = (r: RecipientGroup): boolean =>
    r.recipientKind === "external_beneficiary" &&
    r.recipientId != null &&
    charityIds.has(r.recipientId);

  const toCharity = (report.firstDeath?.recipients ?? [])
    .concat(report.secondDeath?.recipients ?? [])
    .filter(isCharity)
    .reduce((s, r) => s + r.netTotal, 0);

  return {
    year: args.year,
    toHeirs: h.netToHeirs - toCharity,
    taxesAndExpenses: h.taxAndCosts,
    toCharity,
    isEmpty: false,
  };
}

