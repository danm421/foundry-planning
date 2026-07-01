import { resolveScheduledColumnForYear } from "../life-insurance-schedule";
import type { Account, EntitySummary, LifeInsurancePayout } from "../types";

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
  /** Accounts list with triggering policies replaced by taxable proceeds
   *  accounts (subType `life_insurance_proceeds`). All other accounts
   *  unchanged. */
  accounts: Account[];
  /** Balances map. Triggering policy IDs now hold faceValue. */
  accountBalances: Record<string, number>;
  /** Basis map. §101(a) — proceeds are income-tax-free, so basis = faceValue. */
  basisMap: Record<string, number>;
  /** Policy account IDs transformed this pass (diagnostic / reporting). */
  retiredPolicyIds: string[];
  /** Per-policy face-value payouts triggered this pass. */
  lifeInsurancePayouts: LifeInsurancePayout[];
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
  const lifeInsurancePayouts: LifeInsurancePayout[] = [];
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

    // Not-yet-activated policy: no coverage in force at the death year.
    if (account.activationYear != null && input.year < account.activationYear) {
      resultAccounts.push(account);
      continue;
    }

    const policy = account.lifeInsurance;
    const { postPayoutGrowthRate } = policy;
    const scheduledDb =
      policy.deathBenefitScheduleMode === "scheduled"
        ? resolveScheduledColumnForYear(policy.cashValueSchedule, input.year, "deathBenefit")
        : null;
    const faceValue = scheduledDb ?? policy.faceValue;
    const policyId = account.id;

    // §101(a): proceeds are income-tax-free, so basis = faceValue. The account
    // is always transformed to `taxable` so the proceeds — and any growth above
    // face value — flow through the projection's withdrawal/tax engine like any
    // other brokerage asset. (A `cash`-category account is 0%-tax / 100%-basis
    // on withdrawal, so its growth would escape taxation entirely.) When the
    // loader resolved a model portfolio for this policy it carries
    // `postPayoutRealization` (the OI / LTCG / QDiv / tax-exempt mix) — attach
    // it so growth is taxed annually per that mix. Without one, the account is
    // a deferred-gain taxable account: growth is recognized as a capital gain
    // when the account is drawn down.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { lifeInsurance, insuredPerson, ...rest } = account;
    const transformed: Account = {
      ...rest,
      category: "taxable",
      subType: "life_insurance_proceeds",
      value: faceValue,
      basis: faceValue,
      growthRate: postPayoutGrowthRate,
      rmdEnabled: false,
      ...(policy.postPayoutRealization != null
        ? { realization: policy.postPayoutRealization }
        : {}),
    };
    resultAccounts.push(transformed);

    accountBalances[policyId] = faceValue;
    basisMap[policyId] = faceValue;
    retiredPolicyIds.push(policyId);
    lifeInsurancePayouts.push({ policyId, faceValue });

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
    lifeInsurancePayouts,
    warnings,
  };
}
