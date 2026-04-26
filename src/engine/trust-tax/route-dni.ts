import type { EntitySummary } from "../types";

export interface DniRoutingResult {
  toFamilyMember: Record<string, number>;
  toExternal: Record<string, number>;
  toHousehold: number;
}

/**
 * Route DNI across the trust's income-beneficiary list by percentage.
 *
 * - `householdRole` entries ("client" | "spouse") add to `toHousehold` so the
 *   caller can fold them into the household 1040 pass-through buckets.
 * - `familyMemberId` entries go into `toFamilyMember` keyed by id.
 * - `externalBeneficiaryId` entries go into `toExternal` keyed by id.
 * - `entityId` entries on income beneficiaries are disallowed by the UI but
 *   silently ignored here.
 */
export function routeDni(
  incomeBeneficiaries: EntitySummary["incomeBeneficiaries"],
  dniAmount: number,
): DniRoutingResult {
  const result: DniRoutingResult = { toFamilyMember: {}, toExternal: {}, toHousehold: 0 };
  const list = incomeBeneficiaries ?? [];
  if (list.length === 0 || dniAmount <= 0) return result;

  for (const b of list) {
    const share = (dniAmount * b.percentage) / 100;
    if (b.householdRole === "client" || b.householdRole === "spouse") {
      result.toHousehold += share;
    } else if (b.familyMemberId) {
      result.toFamilyMember[b.familyMemberId] = (result.toFamilyMember[b.familyMemberId] ?? 0) + share;
    } else if (b.externalBeneficiaryId) {
      result.toExternal[b.externalBeneficiaryId] = (result.toExternal[b.externalBeneficiaryId] ?? 0) + share;
    }
    // entityId on income beneficiaries is disallowed by UI but ignored silently if present
  }
  return result;
}
