import type { ClientData } from "@/engine/types";
import { computeTermEndYear } from "@/engine/life-insurance-expiry";

/** One existing in-force policy line for the coverage breakdown. */
export interface ExistingPolicyLine {
  name: string;
  faceValue: number;
}

export interface ExistingCoverage {
  policies: ExistingPolicyLine[];
  total: number;
}

/**
 * Existing life-insurance death benefit insuring `deceased` that is in force
 * in `deathYear`. Term policies count when the death year falls within their
 * issue→expiry window; permanent policies (whole/universal/variable) always
 * count. Policies insuring anyone other than `deceased` are excluded — a
 * single premature death only realizes coverage on that life.
 */
export function existingCoverageInForce(
  data: ClientData,
  deceased: "client" | "spouse",
  deathYear: number,
): ExistingCoverage {
  const policies: ExistingPolicyLine[] = [];
  for (const acct of data.accounts) {
    if (acct.category !== "life_insurance" || !acct.lifeInsurance) continue;
    if (acct.insuredPerson !== deceased) continue;
    const policy = acct.lifeInsurance;

    if (policy.policyType === "term") {
      const issue = policy.termIssueYear;
      const endYear = computeTermEndYear({
        policy,
        insured: deceased,
        client: data.client,
      });
      const inForce =
        (issue == null || issue <= deathYear) &&
        (endYear == null || endYear >= deathYear);
      if (!inForce) continue;
    }

    policies.push({ name: acct.name, faceValue: policy.faceValue });
  }
  const total = policies.reduce((s, p) => s + p.faceValue, 0);
  return { policies, total };
}
