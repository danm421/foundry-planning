import type { Account, Expense } from "@/engine/types";

export interface SynthesizePremiumsInput {
  /** The projection's first year — premiums that were issued in the past
   *  start flowing from this year forward (we do not back-date expenses). */
  currentYear: number;
  accounts: Account[];
  /** Year-of-birth for the household's client. Used as the lifespan anchor
   *  for permanent policies on the client with no paid-up horizon. */
  clientBirthYear: number;
  /** Year-of-birth for the spouse, when present. Required when any
   *  permanent, open-ended policy is spouse- or joint-insured. */
  spouseBirthYear: number | null;
  /** Client's assumed life expectancy in years (from ClientInfo). */
  lifeExpectancyClient: number;
  /** Spouse's assumed life expectancy in years. Falls back to the client's
   *  when absent — matches how the engine reports solo-spouse lifespan. */
  lifeExpectancySpouse: number | null;
}

/**
 * Produces synthetic expense rows from life-insurance policies with
 * premium_amount > 0. Expenses are tagged with `source = "policy"` and
 * `sourcePolicyAccountId` set to the policy's account id. The expense
 * inherits the policy account's `ownerEntityId` so entity-owned policies
 * produce entity-scoped premium expenses (matching the engine's cash-
 * routing contract for expenses).
 *
 * End-year resolution priority:
 *   1. Explicit `premiumYears` (paid-up horizon)
 *   2. Term policies: `termIssueYear + termLengthYears - 1` when set,
 *      else a 20-year fallback from startYear.
 *   3. Permanent policies with no paid-up years: the insured's projected
 *      lifespan year (birthYear + lifeExpectancy). Joint uses the later
 *      of the two lifespans.
 */
export function synthesizePremiumExpenses(
  input: SynthesizePremiumsInput,
): Expense[] {
  const out: Expense[] = [];

  for (const acct of input.accounts) {
    if (acct.category !== "life_insurance" || !acct.lifeInsurance) continue;
    const policy = acct.lifeInsurance;
    if (policy.premiumAmount <= 0) continue;

    const issueYear = policy.termIssueYear ?? input.currentYear;
    const startYear =
      issueYear < input.currentYear ? input.currentYear : issueYear;

    let endYear: number;
    if (policy.premiumYears != null) {
      endYear = startYear + policy.premiumYears - 1;
    } else if (policy.policyType === "term") {
      endYear =
        policy.termIssueYear != null && policy.termLengthYears != null
          ? policy.termIssueYear + policy.termLengthYears - 1
          : startYear + 20 - 1; // 20-year fallback for malformed term rows
    } else {
      // Permanent, no paid-up horizon → pay until insured's lifespan.
      endYear = resolvePermanentLifespanYear(acct, input);
    }

    // Guard against nonsensical ranges (e.g., endYear < startYear from a
    // back-dated term policy). Skip emitting an expense row in that case.
    if (endYear < startYear) continue;

    out.push({
      id: `premium-${acct.id}`,
      type: "insurance",
      name: `${acct.name} premium`,
      annualAmount: policy.premiumAmount,
      startYear,
      endYear,
      growthRate: 0,
      ownerEntityId: acct.ownerEntityId ?? undefined,
      source: "policy",
      sourcePolicyAccountId: acct.id,
    });
  }
  return out;
}

function resolvePermanentLifespanYear(
  acct: Account,
  input: SynthesizePremiumsInput,
): number {
  const insured = acct.insuredPerson ?? "client";
  const { clientBirthYear, spouseBirthYear, lifeExpectancyClient } = input;
  const lifeExpectancySpouse =
    input.lifeExpectancySpouse ?? input.lifeExpectancyClient;

  if (insured === "client") {
    return clientBirthYear + lifeExpectancyClient;
  }
  if (insured === "spouse") {
    // Fall back to client's birth-year when spouse DoB is missing (mis-shaped
    // data). The UI validation should prevent this in practice.
    return (spouseBirthYear ?? clientBirthYear) + lifeExpectancySpouse;
  }
  // joint — premium runs until the later of the two lifespans.
  const clientEnd = clientBirthYear + lifeExpectancyClient;
  const spouseEnd =
    (spouseBirthYear ?? clientBirthYear) + lifeExpectancySpouse;
  return Math.max(clientEnd, spouseEnd);
}
