import type { ClientData, Expense, LtcPolicy } from "@/engine/types";

/**
 * Standalone LTC premiums as household `insurance` expenses. Level (growth 0):
 * premium rate increases are out of scope. A rider bills nothing — its cost is
 * inside the life policy's premium.
 *
 * ── ORDERING INVARIANT (same as disability-premium-expense.ts) ────────────
 * These rows carry `source: "policy"` so the editable surfaces hide them.
 * `withSynthesizedPremiums` strips EVERY `source: "policy"` row and regenerates
 * only life-insurance premiums, so this link must run AFTER it, or the LTC
 * premium vanishes silently. Call sites: projection/load-client-data.ts and
 * scenario/loader.ts. Pinned by "survives only when it runs AFTER" in the test.
 *
 * Waiver of premium during an LTC stress event is Part 2's: the engine
 * pre-pass ends these rows (found by the `ltc-premium-` id prefix).
 */
export function synthesizeLtcPremiums(tree: ClientData): Expense[] {
  const out: Expense[] = [];
  for (const policy of tree.ltcPolicies ?? []) {
    if (policy.kind !== "standalone" || policy.annualPremium <= 0) continue;
    const years = ltcPremiumWindow(policy, tree);
    if (!years) continue;
    out.push({
      id: `ltc-premium-${policy.id}`,
      type: "insurance",
      name: `${policy.name} premium`,
      annualAmount: policy.annualPremium,
      startYear: years.startYear,
      endYear: years.endYear,
      growthRate: 0,
      source: "policy",
    });
  }
  return out;
}

/** The years a standalone policy bills, or null when it bills none.
 *
 *  Every window also stops in the insured's life-expectancy year: the engine
 *  never ends an `insurance` expense at a death, so a pay-to-age or pay-years
 *  premium would otherwise bill the survivor for a dead person's policy.
 *
 *  Null — no row at all — when the insured's date of birth is missing or
 *  malformed, their life expectancy is unknown on a lifetime premium, or the
 *  window ends before it starts. No silent fallback to the plan end or to the
 *  client's birth year (the disability rule): billing years nobody can place
 *  is the bug. */
export function ltcPremiumWindow(
  policy: LtcPolicy,
  tree: ClientData,
): { startYear: number; endYear: number } | null {
  const { client, planSettings } = tree;
  const dob = policy.insured === "spouse" ? client.spouseDob : client.dateOfBirth;
  if (!dob) return null;
  const birthYear = parseInt(dob.slice(0, 4), 10);
  if (!Number.isFinite(birthYear)) return null;
  // A co-client's missing expectancy falls back to the client's — the same
  // rule the engine and the life-insurance premium use.
  const le =
    policy.insured === "spouse"
      ? (client.spouseLifeExpectancy ?? client.lifeExpectancy)
      : client.lifeExpectancy;
  const deathYear = le == null ? null : birthYear + le;

  const startYear = Math.max(planSettings.planStartYear, policy.issueYear);
  let endYear: number;
  switch (policy.premiumPayMode) {
    case "paid_up":
      return null;
    case "lifetime":
      if (deathYear == null) return null;
      endYear = deathYear;
      break;
    case "to_age":
      if (policy.premiumPayToAge == null) return null;
      endYear = birthYear + policy.premiumPayToAge - 1;
      break;
    case "years":
      if (policy.premiumPayYears == null) return null;
      endYear = policy.issueYear + policy.premiumPayYears - 1;
      break;
  }
  if (deathYear != null) endYear = Math.min(endYear, deathYear);
  return endYear >= startYear ? { startYear, endYear } : null;
}

/** Strip prior LTC premium rows and re-derive. Keys off the `ltc-premium-` id
 *  prefix, not `source` — a `source` filter would also eat the life and
 *  disability premiums. Idempotent. Must run AFTER `withSynthesizedPremiums`. */
export function withSynthesizedLtcPremiums(tree: ClientData): ClientData {
  const kept = tree.expenses.filter((e) => !e.id.startsWith("ltc-premium-"));
  return { ...tree, expenses: [...kept, ...synthesizeLtcPremiums(tree)] };
}
