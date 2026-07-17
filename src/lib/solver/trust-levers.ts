import type { Account, BeneficiaryRef, EntitySummary } from "@/engine/types";
import type { TrustSubType } from "@/lib/entities/trust";
import { defaultIsGrantorFor } from "@/lib/trust-defaults";
import type { SolverMutation } from "./types";

/** Trust subtypes the solver can CREATE in Phase 3a. CRT/CLT are Phase 3b. */
export const SOLVER_TRUST_SUBTYPES_3A = ["ilit", "idgt", "irrevocable"] as const;
export type SolverTrustSubType3a = (typeof SOLVER_TRUST_SUBTYPES_3A)[number];

interface BuildTrustEntityArgs {
  id: string;
  name: string;
  /** Full TrustSubType: 3a (ilit|idgt|irrevocable) + 3b split-interest (crt|clt).
   *  Non-crummey; isGrantor comes from defaultIsGrantorFor (crt→false, clt→true). */
  subType: TrustSubType;
  grantor: "client" | "spouse";
}

/**
 * Build the EntitySummary for a solver-created irrevocable trust. Defaults
 * replicate AddTrustForm create-mode: every trust is out of estate
 * (isIrrevocable true, includeInPortfolio false); ILIT carries Crummey powers;
 * IDGT and CLT are grantor trusts.
 *
 * Note: crummeyPowers is ILIT-defaulted here (the form toggles it). isGrantor now
 * comes from the shared defaultIsGrantorFor() used by BOTH surfaces — idgt and clt
 * default to grantor, crt stays false (§664(c) makes the flag inert for a CRT).
 */
export function buildTrustEntity({ id, name, subType, grantor }: BuildTrustEntityArgs): EntitySummary {
  return {
    id,
    name,
    entityType: "trust",
    isIrrevocable: true,
    includeInPortfolio: false,
    accessibleToClient: false,
    trustEnds: "survivorship",
    grantor,
    trustSubType: subType,
    crummeyPowers: subType === "ilit",
    isGrantor: defaultIsGrantorFor(subType),
  };
}

/**
 * ILIT funding: retitle a life-insurance policy into the trust, seed the trust as
 * sole primary beneficiary, and set premiumPayer to the grantor so the premiums
 * become Crummey gifts (premium-gift.ts planPremiumGift returns null when
 * premiumPayer === "owner").
 */
export function buildIlitFundingMutation(
  policy: Account,
  entityId: string,
  grantor: "client" | "spouse",
  beneficiaryId: string,
): SolverMutation {
  const beneficiary: BeneficiaryRef = {
    id: beneficiaryId,
    tier: "primary",
    percentage: 100,
    entityIdRef: entityId,
    sortOrder: 0,
  };
  return {
    kind: "account-upsert",
    id: policy.id,
    value: {
      ...policy,
      owners: [{ kind: "entity", entityId, percent: 1 }],
      beneficiaries: [beneficiary],
      lifeInsurance: policy.lifeInsurance
        ? { ...policy.lifeInsurance, premiumPayer: grantor }
        : policy.lifeInsurance,
    },
  };
}

/** IDGT / plain-irrevocable funding: retitle an existing account into the trust. */
export function buildRetitleFundingMutation(account: Account, entityId: string): SolverMutation {
  return {
    kind: "account-upsert",
    id: account.id,
    value: { ...account, owners: [{ kind: "entity", entityId, percent: 1 }] },
  };
}

/** Restore a funded account to its original owners (trust delete / unfund). */
export function buildRevertFundingMutation(original: Account): SolverMutation {
  return { kind: "account-upsert", id: original.id, value: original };
}

/** Accounts eligible to retitle into an IDGT/irrevocable trust: household-owned,
 *  non-insurance (life-insurance goes through the ILIT path). */
export function isRetitleFundingEligible(a: Account): boolean {
  return a.category !== "life_insurance" && a.owners.every((o) => o.kind === "family_member");
}
