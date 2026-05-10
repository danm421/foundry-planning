import type { Account, EntitySummary } from "../types";

export interface PreparePayoutsInput {
  year: number;
  deceased: "client" | "spouse";
  eventKind: "first_death" | "final_death";
  accounts: Account[];
  accountBalances: Record<string, number>;
  basisMap: Record<string, number>;
  entities: EntitySummary[];
}

export interface PreparePayoutsResult {
  /** Accounts list with triggering policies replaced by cash-equivalents
   *  (or taxable accounts when a model-portfolio realization mix is resolved).
   *  All other accounts unchanged. */
  accounts: Account[];
  /** Balances map. Triggering policy IDs now hold faceValue. */
  accountBalances: Record<string, number>;
  /** Basis map. §101(a) — proceeds are income-tax-free, so basis = faceValue. */
  basisMap: Record<string, number>;
  /** Policy account IDs transformed this pass (diagnostic / reporting). */
  retiredPolicyIds: string[];
  /** Engine warnings — currently only `life_insurance_no_beneficiaries:<policyId>`. */
  warnings: string[];
}

/** Returns true when the policy triggers a payout this event. */
function triggers(
  account: Account,
  deceased: "client" | "spouse",
  eventKind: "first_death" | "final_death",
): boolean {
  const insured = account.insuredPerson ?? null;
  if (insured === deceased) return true;
  if (insured === "joint" && eventKind === "final_death") return true;
  return false;
}

export function prepareLifeInsurancePayouts(
  input: PreparePayoutsInput,
): PreparePayoutsResult {
  const { deceased, eventKind, accounts } = input;

  const accountBalances: Record<string, number> = { ...input.accountBalances };
  const basisMap: Record<string, number> = { ...input.basisMap };
  const retiredPolicyIds: string[] = [];
  const warnings: string[] = [];
  const resultAccounts: Account[] = [];

  for (const account of accounts) {
    if (account.category !== "life_insurance" || account.lifeInsurance === undefined) {
      resultAccounts.push(account);
      continue;
    }

    if (!triggers(account, deceased, eventKind)) {
      resultAccounts.push(account);
      continue;
    }

    const policy = account.lifeInsurance;
    const { faceValue, postPayoutGrowthRate } = policy;
    const policyId = account.id;

    // Default: cash-equivalent at the policy's flat growth rate.
    // Model-portfolio path: when the loader resolved a model portfolio for
    // this policy, the policy carries `postPayoutRealization` and a
    // portfolio-derived `postPayoutGrowthRate` — we transform into a taxable
    // account so realization (OI / LTCG / QDiv / tax-exempt) flows through
    // the projection's tax engine instead of being treated as interest.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { lifeInsurance, insuredPerson, ...rest } = account;
    const useTaxable = policy.postPayoutRealization != null;
    const transformed: Account = {
      ...rest,
      category: useTaxable ? "taxable" : "cash",
      subType: "life_insurance_proceeds",
      value: faceValue,
      basis: faceValue,
      growthRate: postPayoutGrowthRate,
      rmdEnabled: false,
      ...(useTaxable
        ? { realization: policy.postPayoutRealization }
        : {}),
    };
    resultAccounts.push(transformed);

    accountBalances[policyId] = faceValue;
    basisMap[policyId] = faceValue;
    retiredPolicyIds.push(policyId);

    const hasPrimary = account.beneficiaries?.some((b) => b.tier === "primary") ?? false;
    if (!hasPrimary) {
      warnings.push(`life_insurance_no_beneficiaries:${policyId}`);
    }
  }

  return {
    accounts: resultAccounts,
    accountBalances,
    basisMap,
    retiredPolicyIds,
    warnings,
  };
}
