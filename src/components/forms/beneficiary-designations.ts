import type { Designation } from "../family-view";
import type { BeneficiaryRef } from "@/engine/types";

/** A scenario's `BeneficiaryRef`s as the beneficiary editors' rows. */
export function refsToDesignations(refs: BeneficiaryRef[], accountId: string): Designation[] {
  return refs.map((r) => ({
    id: r.id,
    targetKind: "account",
    accountId,
    entityId: null,
    tier: r.tier,
    familyMemberId: r.familyMemberId ?? null,
    externalBeneficiaryId: r.externalBeneficiaryId ?? null,
    entityIdRef: r.entityIdRef ?? null,
    householdRole: r.householdRole ?? null,
    percentage: r.percentage,
    sortOrder: r.sortOrder,
  }));
}
