import type { RecipientInput, StateInheritanceTaxRule } from "./types";

export interface Exclusion {
  amount: number;
  reason: string;
}

export function computeExclusions(
  rule: StateInheritanceTaxRule,
  r: RecipientInput,
  decedentAge: number,
): Exclusion[] {
  const exclusions: Exclusion[] = [];

  if (rule.excludesAllLifeInsurance) {
    const lifeIns = r.components
      .filter((c) => c.kind === "life_insurance")
      .reduce((s, c) => s + c.amount, 0);
    if (lifeIns > 0) {
      exclusions.push({
        amount: lifeIns,
        reason: "All life insurance excluded (PA 72 Pa.C.S. §9116(a)).",
      });
    }
  }

  if (rule.excludesIraIfDecedentUnder59Half && decedentAge < 59.5) {
    const ira = r.components
      .filter((c) => c.kind === "ira")
      .reduce((s, c) => s + c.amount, 0);
    if (ira > 0) {
      exclusions.push({
        amount: ira,
        reason: "IRA excluded — decedent was under 59½ at death (PA 72 Pa.C.S. §9111(r)).",
      });
    }
  }

  if (rule.beneficiaryAgeExemptUnder != null && r.age != null && r.age < rule.beneficiaryAgeExemptUnder) {
    exclusions.push({
      amount: r.grossShare,
      reason: `Beneficiary under age ${rule.beneficiaryAgeExemptUnder} — fully exempt (Neb. Rev. Stat. §77-2007.04, LB310).`,
    });
  }

  if (rule.domesticPartnerResidenceExemption && r.primaryResidenceJointlyHeldWithDomesticPartner && r.domesticPartner) {
    // MD: full grossShare excluded when this flag is set; advisor responsible for
    // setting it only on the residence-related share.
    exclusions.push({
      amount: r.grossShare,
      reason: "Primary residence held jointly with domestic partner — exempt (MD Tax-Gen. §7-203(c)).",
    });
  }

  return exclusions;
}
