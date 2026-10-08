// src/lib/insurance-policies/ltc-rider-link.ts

/** What the rider rule needs to know about the account a rider names. */
export interface RiderLifePolicy {
  id: string;
  category: string;
  insuredPerson: "client" | "spouse" | "joint" | null;
}

/** Null when `account` can carry a rider for `insured`; else the sentence the
 *  advisor reads. The base routes run it against the database row; the dialog
 *  never offers anything else (`eligibleRiderPolicies`). */
export function riderLinkProblem(
  insured: "client" | "spouse",
  account: RiderLifePolicy | null | undefined,
): string | null {
  if (!account || account.category !== "life_insurance") {
    return "Pick one of this household's life insurance policies.";
  }
  if (account.insuredPerson === "joint") return "A rider can't sit on a joint (second-to-die) policy.";
  if (account.insuredPerson !== insured) return "The life policy must insure the same person as the rider.";
  return null;
}

/** The life policies a rider for `insured` may sit on: theirs alone, never a
 *  joint policy. */
export function eligibleRiderPolicies<T extends { insuredPerson: RiderLifePolicy["insuredPerson"] }>(
  insured: "client" | "spouse",
  policies: readonly T[],
): T[] {
  return policies.filter((p) => p.insuredPerson === insured);
}
