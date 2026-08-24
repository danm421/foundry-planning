import type { ClientData, DisabilityPolicy, Expense } from "@/engine/types";

/** Group STD/LTD is usually employer-paid and costs the household nothing.
 *  Individual coverage is a real recurring expense — and every real DI contract
 *  carries waiver of premium, so it stops once the insured is disabled.
 *
 *  ── ORDERING INVARIANT ─────────────────────────────────────────────────────
 *  The rows are tagged `source: "policy"` (see the tag below for why). That tag
 *  is only SAFE while this synthesizer runs AFTER `withSynthesizedPremiums`
 *  (./premium-expense.ts), which strips EVERY `source: "policy"` expense and
 *  re-derives only from life-insurance ACCOUNTS — it knows nothing about
 *  disability policies. Run it after us and the disability premium is deleted
 *  and never regenerated: it VANISHES SILENTLY, no error, no warning.
 *
 *  There are exactly three non-test call sites and all honour the ordering:
 *    - projection/load-client-data.ts — this synthesizer wraps the
 *      life-insurance chain outermost.
 *    - scenario/loader.ts — this link sits after the life-insurance links.
 *    - solver/apply-mutations.ts — re-derives from the MUTATED tree, because
 *      the stress-disability lever writes `planSettings.disabilityEvent` after
 *      both loaders have already run and waiver of premium reads it. Safe:
 *      `applyMutations` never calls `withSynthesizedPremiums`, and the tree it
 *      receives has already been through it at load.
 *  Any further call site must sit downstream of `withSynthesizedPremiums`. The
 *  "ORDERING INVARIANT" test in ./__tests__/disability-premium-expense.test.ts
 *  pins both directions. */
export function synthesizeDisabilityPremiums(tree: ClientData): Expense[] {
  const policies = tree.disabilityPolicies ?? [];
  if (policies.length === 0) return [];

  const { planSettings } = tree;
  const event = planSettings.disabilityEvent;
  const out: Expense[] = [];

  for (const policy of policies) {
    if (policy.premiumPayer !== "insured" || policy.annualPremium <= 0) continue;

    const endYear = retirementYear(policy, tree);
    // Unresolvable insured (no DOB / no retirement age / malformed DOB): emit
    // NOTHING. See the note on `retirementYear` — no silent fallback.
    if (endYear == null) continue;
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
      // Marks the row as synthesized. Four surfaces gate on
      // `source !== "policy"` and would otherwise offer this row for edit or
      // delete even though NO DB ROW EXISTS behind its `disability-premium-…`
      // id: the client portal (portal/portal-flow-writable.ts — a live 500 on
      // the base PUT, whose column is a uuid), the manual income/expense
      // editor, the onboarding cash-flow step, and the household-map edit
      // drawer. Read the ORDERING INVARIANT above before moving any call site:
      // this tag makes the row deletable by `withSynthesizedPremiums`.
      source: "policy",
      // Deliberately NO `growthSource: "inflation"`. That field exists so
      // `reResolveInflationGrowth` (projection/resolve-inflation-growth.ts) can
      // re-stamp a row's growthRate when a scenario edits the inflation rate.
      // This row is re-derived from scratch at a chain position AFTER that
      // re-resolution runs (scenario/loader.ts), so it already reads the
      // effective `planSettings.inflationRate` first-hand. Adding the field
      // would be redundant at best; at the current ordering it is simply never
      // consulted, so do not "fix" its absence.
    });
  }
  return out;
}

/** Retirement year of the policy's OWN insured person — a spouse-insured
 *  policy follows the spouse's DOB + retirement age, never the client's.
 *
 *  Returns `null` when it cannot resolve. The caller must then emit no row at
 *  all: `spouseDob` / `spouseRetirementAge` are optional on `ClientInfo` while
 *  the client's own are required, so this is reachable for a spouse-insured
 *  policy — exactly the shape whose age-based benefit period also pays zero.
 *  The binding rule is "an age-based period that cannot resolve pays NOTHING
 *  and surfaces a warning; no silent fallback to plan end, to zero, or to the
 *  client's DOB", so BOTH available fallbacks (planEndYear here, the client's
 *  figures as the life-insurance sibling does in ./premium-expense.ts) are
 *  forbidden. Surfacing the warning is the UI's job, off `resolveCoverage`'s
 *  `unresolved`. Billing ~30 years of premium for a policy that pays $0 is the
 *  bug this prevents. */
function retirementYear(policy: DisabilityPolicy, tree: ClientData): number | null {
  const { client } = tree;
  const dob = policy.insured === "spouse" ? client.spouseDob : client.dateOfBirth;
  const age = policy.insured === "spouse" ? client.spouseRetirementAge : client.retirementAge;
  if (!dob || age == null) return null;
  const birthYear = parseInt(dob.slice(0, 4), 10);
  // A malformed DOB parses to NaN, and NaN comparisons are always false — an
  // unguarded row would escape the caller's `resolvedEnd < planStartYear`
  // check and be emitted with `endYear: NaN`, billing nothing, forever, in
  // silence. Same guard as `birthYear` in engine/retirement-proration.ts.
  if (!Number.isFinite(birthYear)) return null;
  return birthYear + age;
}

/** Strip prior disability-premium rows and re-derive. Mirrors
 *  `withSynthesizedPremiums` for life insurance, except the prior-row filter
 *  keys off the `disability-premium-` id prefix rather than `source`: these
 *  rows DO carry `source: "policy"`, so a `source`-keyed filter here would also
 *  eat the life-insurance premiums this function must leave alone. Idempotent.
 *
 *  Must run AFTER `withSynthesizedPremiums` — see the ORDERING INVARIANT on
 *  `synthesizeDisabilityPremiums`. */
export function withSynthesizedDisabilityPremiums(tree: ClientData): ClientData {
  const kept = tree.expenses.filter((e) => !e.id.startsWith("disability-premium-"));
  return { ...tree, expenses: [...kept, ...synthesizeDisabilityPremiums(tree)] };
}
