import type { ProjectionResult, ClientData } from "@/engine";
import { collectCharityExternalBeneficiaryIds } from "./charity-recipients";
import { lifetimeGiftsToHeirs } from "./lifetime-gifts-to-people";
import { buildEstateTransferReportData, type RecipientGroup } from "./transfer-report";
import { heldInTrustForHeirs } from "./held-in-trust-for-heirs";
import { summarizeHousehold } from "@/lib/presentations/pages/estate-summary/aggregate";

export interface EstateDistribution {
  year: number;
  /** What heirs receive at the year's deaths PLUS `lifetimeGifts` PLUS
   *  `heldInTrust` — gifting moves wealth to heirs early, so it must not read
   *  as a loss to them. */
  toHeirs: number;
  /** Gifts already made to heirs (people other than the couple and charities)
   *  on or before `year`, inside `toHeirs`. See `lifetimeGiftsToHeirs`. */
  lifetimeGifts: number;
  /** What irrevocable trusts hold for the heirs at `year`, inside `toHeirs`.
   *  See `heldInTrustForHeirs`. */
  heldInTrust: number;
  taxesAndExpenses: number;
  /** The income tax an heir owes on an inherited pre-tax account, already
   *  inside `taxesAndExpenses`. Broken out because it is usually the largest
   *  line and the only one a Roth conversion can move — a narrative that says
   *  "taxes and costs" without it cannot explain why the conversion helped. */
  ird: number;
  toCharity: number;
  isEmpty: boolean;
}

/** The year end-of-life heirs figures are read at: the second death, or the
 *  projection's last year when there is none (a single client's projection
 *  ends at their death). */
export function endOfLifeYear(projection: Pick<ProjectionResult, "secondDeathEvent" | "years">): number | undefined {
  return projection.secondDeathEvent?.year ?? projection.years.at(-1)?.year;
}

/** `lifetimeGiftsToHeirs` through `endOfLifeYear` — the gifts every
 *  end-of-life heirs figure stands beside. */
export function lifetimeGiftsToHeirsAtEndOfLife(
  clientData: ClientData,
  projection: Pick<ProjectionResult, "secondDeathEvent" | "years">,
): number {
  const year = endOfLifeYear(projection);
  return year != null ? lifetimeGiftsToHeirs(clientData, year, projection) : 0;
}

/** `heldInTrustForHeirs` at `endOfLifeYear` — like the lifetime gifts, it
 *  stands beside every end-of-life heirs figure. */
export function heldInTrustForHeirsAtEndOfLife(
  clientData: ClientData,
  projection: Pick<ProjectionResult, "secondDeathEvent" | "years">,
): number {
  const year = endOfLifeYear(projection);
  return year != null ? heldInTrustForHeirs(clientData, projection, year) : 0;
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
    return {
      year: args.year,
      toHeirs: 0,
      lifetimeGifts: 0,
      heldInTrust: 0,
      taxesAndExpenses: 0,
      ird: 0,
      toCharity: 0,
      isEmpty: true,
    };
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

  const lifetimeGifts = lifetimeGiftsToHeirs(args.clientData, args.year, args.projection);
  const heldInTrust = heldInTrustForHeirs(args.clientData, args.projection, args.year);

  return {
    year: args.year,
    toHeirs: h.netToHeirs - toCharity + lifetimeGifts + heldInTrust,
    lifetimeGifts,
    heldInTrust,
    taxesAndExpenses: h.taxAndCosts,
    ird: h.ird,
    toCharity,
    isEmpty: false,
  };
}

