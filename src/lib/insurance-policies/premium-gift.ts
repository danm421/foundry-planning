import type { Account } from "@/engine/types";
import { controllingEntity } from "@/engine/ownership";

export type PremiumPayer = "owner" | "client" | "spouse" | "both";

export interface PremiumGiftContext {
  /** Family-member ids that are household principals (client + spouse). A policy
   *  owned by a principal is "paid by the household" — no gift arises. */
  principalFamilyMemberIds: Set<string>;
  /** crummey_powers by entity id, from EntitySummary. */
  crummeyByEntityId: Map<string, boolean>;
}

export interface PremiumGiftPlan {
  grantor: "client" | "spouse" | "joint";
  recipient: { kind: "entity"; entityId: string } | { kind: "individual" };
  useCrummeyPowers: boolean;
}

/** Decide whether (and how) a policy's premium becomes a gift. Returns null when
 *  no gift arises: payer is the owner, payer is unset, or the owner is a household
 *  principal (the household already funds it directly). */
export function planPremiumGift(
  acct: Account,
  ctx: PremiumGiftContext,
): PremiumGiftPlan | null {
  const payer = acct.lifeInsurance?.premiumPayer ?? "owner";
  if (payer === "owner") return null;
  const grantor: "client" | "spouse" | "joint" = payer === "both" ? "joint" : payer;

  // Entity (trust) owner → gift to the trust; Crummey inherited from the trust.
  const entityId = controllingEntity(acct);
  if (entityId != null) {
    return {
      grantor,
      recipient: { kind: "entity", entityId },
      useCrummeyPowers: ctx.crummeyByEntityId.get(entityId) ?? false,
    };
  }

  // Owned entirely by household principals → no gift.
  const familyRows = acct.owners.filter((o) => o.kind === "family_member");
  const hasNonPrincipalOrExternal =
    acct.owners.some((o) => o.kind === "external_beneficiary") ||
    familyRows.some((o) => !ctx.principalFamilyMemberIds.has(o.familyMemberId));
  if (!hasNonPrincipalOrExternal && familyRows.length > 0) return null;

  // Non-principal individual / external owner → gift to that person (unmodeled
  // recipient: cash leaves the household, no entity to credit, no Crummey).
  return { grantor, recipient: { kind: "individual" }, useCrummeyPowers: false };
}
