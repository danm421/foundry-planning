import type { ClientData, DisabilityPolicy, Expense } from "@/engine/types";

/** Group STD/LTD is usually employer-paid and costs the household nothing.
 *  Individual coverage is a real recurring expense — and every real DI contract
 *  carries waiver of premium, so it stops once the insured is disabled.
 *
 *  Deliberately does NOT set `source: "policy"` on the produced rows (unlike
 *  the life-insurance premium synthesizer). `withSynthesizedPremiums`
 *  (premium-expense.ts) re-derives life-insurance premiums per scenario by
 *  filtering `tree.expenses` down to `source !== "policy"` and re-appending
 *  freshly computed life-insurance rows — it knows nothing about disability
 *  policies. A disability-premium row tagged `source: "policy"` would be
 *  stripped by that filter (in `applyScenarioChangesWithRefs`) and never
 *  regenerated, silently vanishing from every scenario's effective tree. */
export function synthesizeDisabilityPremiums(tree: ClientData): Expense[] {
  const policies = tree.disabilityPolicies ?? [];
  if (policies.length === 0) return [];

  const { planSettings } = tree;
  const event = planSettings.disabilityEvent;
  const out: Expense[] = [];

  for (const policy of policies) {
    if (policy.premiumPayer !== "insured" || policy.annualPremium <= 0) continue;

    const endYear = retirementYear(policy, tree);
    // Waiver of premium: once the INSURED person's own disability event has
    // started, the insurer stops charging from that year forward, so the
    // last billed year is the year before it starts.
    const waived =
      event && event.person === policy.insured ? event.startYear - 1 : Infinity;
    const resolvedEnd = Math.min(endYear, waived);
    if (resolvedEnd < planSettings.planStartYear) continue;

    out.push({
      id: `disability-premium-${policy.id}`,
      type: "insurance",
      name: `${policy.name} premium`,
      annualAmount: policy.annualPremium,
      startYear: planSettings.planStartYear,
      endYear: resolvedEnd,
      growthRate: planSettings.inflationRate,
    });
  }
  return out;
}

/** Retirement year of the policy's OWN insured person — a spouse-insured
 *  policy follows the spouse's DOB + retirement age, never the client's. */
function retirementYear(policy: DisabilityPolicy, tree: ClientData): number {
  const { client, planSettings } = tree;
  const dob = policy.insured === "spouse" ? client.spouseDob : client.dateOfBirth;
  const age = policy.insured === "spouse" ? client.spouseRetirementAge : client.retirementAge;
  // No DOB or no retirement age => bill to plan end rather than guess an age.
  if (!dob || age == null) return planSettings.planEndYear;
  return parseInt(dob.slice(0, 4), 10) + age;
}

/** Strip prior disability-premium rows and re-derive. Mirrors
 *  `withSynthesizedPremiums` for life insurance, except the prior-row filter
 *  keys off the `disability-premium-` id prefix rather than `source`,
 *  because these rows never carry `source: "policy"` (see the note above). */
export function withSynthesizedDisabilityPremiums(tree: ClientData): ClientData {
  const kept = tree.expenses.filter((e) => !e.id.startsWith("disability-premium-"));
  return { ...tree, expenses: [...kept, ...synthesizeDisabilityPremiums(tree)] };
}
