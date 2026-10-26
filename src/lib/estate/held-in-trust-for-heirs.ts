import type { ClientData, ProjectionResult } from "@/engine";
import { collectCharityExternalBeneficiaryIds } from "./charity-recipients";
import { computeOutOfEstate, resolveTrustBeneficiaries } from "./estate-flow-summary";

/**
 * What irrevocable trusts hold for the heirs at `year`. That money is already
 * outside the estate, so no death passes it on and the death ledger behind
 * every "to heirs" figure never sees it. Each trust counts at its value in the
 * Estate Flow chart's Out of Estate column (an ILIT's in-force policy at face
 * value), less the share its beneficiaries — as the chart's heir boxes split
 * it — leave to charity.
 *
 * Money a will or beneficiary designation moves INTO one of these trusts at a
 * real first death is not in that column (the trust holds no locked share of
 * the account), so it counts once — as the death's transfer to the trust.
 */
export function heldInTrustForHeirs(
  clientData: ClientData,
  projection: Pick<ProjectionResult, "years">,
  year: number,
): number {
  // Most households have no irrevocable trust — skip the account pass.
  if (!clientData.entities?.some((e) => e.entityType === "trust" && e.isIrrevocable === true)) {
    return 0;
  }
  // Reads only `years`.
  const { irrevTrusts } = computeOutOfEstate(clientData, year, [], projection as ProjectionResult);
  if (irrevTrusts.total <= 0) return 0;

  const charityIds = collectCharityExternalBeneficiaryIds(clientData);
  let total = 0;
  for (const trust of irrevTrusts.entities) {
    const charityShare = resolveTrustBeneficiaries(trust.entityId, clientData)
      .filter((s) => charityIds.has(s.recipientKey))
      .reduce((sum, s) => sum + s.weight, 0);
    total += trust.amount * (1 - charityShare);
  }
  return total;
}
