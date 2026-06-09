export type GiftInput = {
  amount: number;
  useCrummeyPowers: boolean;
  recipientEntityId: string | null;
  recipientFamilyMemberId: string | null;
  recipientExternalBeneficiaryId: string | null;
};

export type EntityType =
  | "trust"
  | "llc"
  | "s_corp"
  | "c_corp"
  | "partnership"
  | "foundation"
  | "other";

export type GiftContext = {
  entity?: { isIrrevocable: boolean; entityType: EntityType };
  external?: { kind: "charity" | "individual" };
  annualExclusionAmount: number;
  crummeyBeneficiaryCount: number;
};

export type GiftTreatment = {
  lifetimeUsed: number;
  annualExcluded: number;
  charitableExcluded: number;
};

export function computeGiftTaxTreatment(
  gift: GiftInput,
  ctx: GiftContext,
): GiftTreatment {
  // Outright gift to a natural person: one annual exclusion, remainder draws
  // lifetime exemption. Shared by the family-member, external-individual, and
  // no-modeled-recipient paths.
  const outrightIndividual = (): GiftTreatment => {
    const annual = Math.min(gift.amount, ctx.annualExclusionAmount);
    return { lifetimeUsed: gift.amount - annual, annualExcluded: annual, charitableExcluded: 0 };
  };

  if (gift.recipientEntityId) {
    if (!ctx.entity) {
      throw new Error("computeGiftTaxTreatment: entity context required for entity recipient");
    }
    if (ctx.entity.entityType !== "trust") {
      throw new Error("computeGiftTaxTreatment: entity recipient must be a trust");
    }
    if (!ctx.entity.isIrrevocable) {
      throw new Error("computeGiftTaxTreatment: gifts to revocable trusts are not completed gifts");
    }

    if (!gift.useCrummeyPowers || ctx.crummeyBeneficiaryCount <= 0) {
      return { lifetimeUsed: gift.amount, annualExcluded: 0, charitableExcluded: 0 };
    }

    const annual = Math.min(
      gift.amount,
      ctx.annualExclusionAmount * ctx.crummeyBeneficiaryCount,
    );
    return {
      lifetimeUsed: gift.amount - annual,
      annualExcluded: annual,
      charitableExcluded: 0,
    };
  }

  if (gift.recipientFamilyMemberId) {
    return outrightIndividual();
  }

  if (gift.recipientExternalBeneficiaryId) {
    if (!ctx.external) {
      throw new Error("computeGiftTaxTreatment: external context required for external recipient");
    }
    if (ctx.external.kind === "charity") {
      return { lifetimeUsed: 0, annualExcluded: 0, charitableExcluded: gift.amount };
    }
    return outrightIndividual();
  }

  // No modeled recipient — cash leaving the household to an unmodeled
  // individual (e.g. an individual-owned life-insurance premium gift).
  // Treated as an outright individual gift: one annual exclusion, remainder
  // consumes lifetime exemption. (Spec decision: not an error.)
  return outrightIndividual();
}
