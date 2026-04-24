import type { LifeInsurancePolicy, ClientInfo } from "./types";

export interface ComputeTermEndYearInput {
  policy: LifeInsurancePolicy;
  insured: "client" | "spouse" | "joint";
  client: ClientInfo;
}

/** Returns the last year the policy is in-force, or null if non-term. */
export function computeTermEndYear(input: ComputeTermEndYearInput): number | null {
  const { policy, insured, client } = input;

  if (policy.policyType !== "term") return null;

  if (policy.endsAtInsuredRetirement) {
    const clientRetireYear =
      parseInt(client.dateOfBirth.slice(0, 4), 10) + client.retirementAge;

    if (insured === "client") return clientRetireYear;

    if (!client.spouseDob || client.spouseRetirementAge == null) {
      throw new Error(
        `computeTermEndYear: missing spouse dob/retirementAge for ${insured}-insured policy`,
      );
    }
    const spouseRetireYear =
      parseInt(client.spouseDob.slice(0, 4), 10) + client.spouseRetirementAge;

    if (insured === "spouse") return spouseRetireYear;
    return Math.max(clientRetireYear, spouseRetireYear); // joint
  }

  if (policy.termIssueYear != null && policy.termLengthYears != null) {
    return policy.termIssueYear + policy.termLengthYears - 1;
  }

  return null; // malformed; UI validation should prevent this
}
