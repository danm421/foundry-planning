import type { Account, ClientData, Income } from "@/engine/types";
import { controllingEntity } from "@/engine/ownership";

/**
 * Synthesize non-taxable income rows from life-insurance policies whose
 * `incomeScheduleMode === "scheduled"`. Mirrors `synthesizePremiumExpenses`:
 * one row per policy, tagged `source: "policy"` + `sourcePolicyAccountId`,
 * with the schedule's `income` column as `scheduleOverrides` (0 outside).
 * Owner routing follows the engine contract — `ownerEntityId` for
 * entity-owned policies, default-checking fallback otherwise.
 */
export function synthesizePolicyIncome(accounts: Account[]): Income[] {
  const out: Income[] = [];
  for (const acct of accounts) {
    if (acct.category !== "life_insurance" || !acct.lifeInsurance) continue;
    const policy = acct.lifeInsurance;
    if (policy.incomeScheduleMode !== "scheduled") continue;

    const overrides: Record<number, number> = {};
    for (const row of policy.cashValueSchedule) {
      if (row.income != null && row.income !== 0) overrides[row.year] = row.income;
    }
    const years = Object.keys(overrides).map(Number);
    if (years.length === 0) continue;

    out.push({
      id: `policy-income-${acct.id}`,
      type: "other",
      name: `${acct.name} income`,
      annualAmount: 0,
      startYear: Math.min(...years),
      endYear: Math.max(...years),
      growthRate: 0,
      scheduleOverrides: overrides,
      owner: insuredToOwner(acct.insuredPerson),
      ownerEntityId: controllingEntity(acct) ?? undefined,
      taxType: "tax_exempt",
      source: "policy",
      sourcePolicyAccountId: acct.id,
    });
  }
  return out;
}

function insuredToOwner(
  insured: Account["insuredPerson"],
): "client" | "spouse" | "joint" {
  return insured === "spouse" || insured === "joint" ? insured : "client";
}

/** Strip prior policy-income rows and re-derive from current accounts. */
export function withSynthesizedPolicyIncome(tree: ClientData): ClientData {
  const nonPolicy = tree.incomes.filter((i) => i.source !== "policy");
  return { ...tree, incomes: [...nonPolicy, ...synthesizePolicyIncome(tree.accounts)] };
}
