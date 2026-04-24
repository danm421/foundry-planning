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
   *  (standalone mode) or removed entirely (merge-target mode). All other
   *  accounts unchanged. */
  accounts: Account[];
  /** Balances map. Standalone-mode: policyId now holds faceValue.
   *  Merge-target mode: policyId removed; target's balance += faceValue. */
  accountBalances: Record<string, number>;
  /** Basis map. §101(a) — proceeds are income-tax-free, so basis = faceValue.
   *  Merge-target credits basis by faceValue on the target. */
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
  const { deceased, eventKind, accounts, entities } = input;

  // Build new (never mutated) copies of the maps.
  const accountBalances: Record<string, number> = { ...input.accountBalances };
  const basisMap: Record<string, number> = { ...input.basisMap };
  const retiredPolicyIds: string[] = [];
  const warnings: string[] = [];
  const resultAccounts: Account[] = [];

  for (const account of accounts) {
    // Only life_insurance accounts with a policy definition are candidates.
    if (account.category !== "life_insurance" || account.lifeInsurance === undefined) {
      resultAccounts.push(account);
      continue;
    }

    if (!triggers(account, deceased, eventKind)) {
      // Policy doesn't trigger this event — pass through unchanged.
      resultAccounts.push(account);
      continue;
    }

    const policy = account.lifeInsurance;
    const { faceValue, postPayoutMergeAccountId, postPayoutGrowthRate } = policy;
    const policyId = account.id;

    // Determine merge-target mode: mergeTargetId truthy AND present in accountBalances.
    const mergeTargetId =
      postPayoutMergeAccountId && accountBalances[postPayoutMergeAccountId] !== undefined
        ? postPayoutMergeAccountId
        : null;

    if (mergeTargetId !== null) {
      // Merge-target mode: credit faceValue to the target, drop the policy account.
      accountBalances[mergeTargetId] = (accountBalances[mergeTargetId] ?? 0) + faceValue;
      basisMap[mergeTargetId] = (basisMap[mergeTargetId] ?? 0) + faceValue;
      delete accountBalances[policyId];
      delete basisMap[policyId];
      retiredPolicyIds.push(policyId);
      // Policy account is NOT pushed to resultAccounts (dropped).
    } else {
      // Standalone mode: transform the account into a cash-equivalent.
      const { lifeInsurance: _li, insuredPerson: _ip, ...rest } = account;
      const transformed: Account = {
        ...rest,
        category: "cash",
        subType: "life_insurance_proceeds",
        value: faceValue,
        basis: faceValue,
        growthRate: postPayoutGrowthRate,
        rmdEnabled: false,
      };
      resultAccounts.push(transformed);

      accountBalances[policyId] = faceValue;
      basisMap[policyId] = faceValue;
      retiredPolicyIds.push(policyId);

      // Warn when no primary beneficiaries are configured.
      const hasPrimary = account.beneficiaries?.some((b) => b.tier === "primary") ?? false;
      if (!hasPrimary) {
        warnings.push(`life_insurance_no_beneficiaries:${policyId}`);
      }
    }
  }

  return {
    accounts: resultAccounts,
    accountBalances,
    basisMap,
    retiredPolicyIds,
    warnings,
    // entities is accepted for forward-compat but not consumed here.
    // (entity-aware §2042 logic lives downstream in computeGrossEstate.)
  };
}
