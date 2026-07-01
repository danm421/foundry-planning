import type { Account, ClientData, Expense } from "@/engine/types";
import { controllingEntity } from "@/engine/ownership";
import { planPremiumGift, buildPremiumGiftContext, type PremiumGiftContext } from "./premium-gift";

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
  /** Client's retirement age. Used to cap premium billing on term policies
   *  with `endsAtInsuredRetirement: true`. */
  clientRetirementAge: number;
  /** Spouse's retirement age. Required when any policy with
   *  `endsAtInsuredRetirement: true` is spouse- or joint-insured. */
  spouseRetirementAge: number | null;
  /** When provided, individual-owned policies whose premium becomes a gift to a
   *  non-entity recipient have their household expense suppressed (the gift is
   *  the outflow). Entity-owned policies keep their entity-scoped expense. */
  giftContext?: PremiumGiftContext;
}

/** The resolved premium billing window for one policy. `mode` distinguishes the
 *  scalar path (flat annualAmount over [startYear, endYear]) from the scheduled
 *  path (per-year overrides). Returns null when the policy bills no premium. */
export interface ResolvedPremiumSchedule {
  startYear: number;
  endYear: number;
  mode: "scalar" | "scheduled";
  annualAmount: number; // scalar only (0 for scheduled)
  overrides: Record<number, number>; // scheduled only ({} for scalar)
}

/**
 * Resolves the premium billing window for a single life-insurance account.
 * Returns null when the account has no billable premium.
 *
 * End-year resolution priority:
 *   1. Explicit `premiumYears` (paid-up horizon)
 *   2. Term policies: `termIssueYear + termLengthYears - 1` when set,
 *      else a 20-year fallback from startYear.
 *   3. Permanent policies with no paid-up years: the insured's projected
 *      lifespan year (birthYear + lifeExpectancy). Joint uses the later
 *      of the two lifespans.
 *
 * Then capped at the insured's retirement year when the policy's
 * `endsAtInsuredRetirement` flag is set (term-only).
 */
export function resolvePremiumSchedule(
  acct: Account,
  input: SynthesizePremiumsInput,
): ResolvedPremiumSchedule | null {
  const policy = acct.lifeInsurance;
  if (!policy) return null;

  // Scheduled premiums short-circuit the scalar path: the per-year amount
  // comes from the schedule's `premiumAmount` column, surfaced as
  // `scheduleOverrides` (amount per year, 0 outside the range).
  if (policy.premiumScheduleMode === "scheduled") {
    const overrides: Record<number, number> = {};
    for (const row of policy.cashValueSchedule) {
      if (row.premiumAmount != null) overrides[row.year] = row.premiumAmount;
    }
    const years = Object.keys(overrides).map(Number);
    if (years.length === 0) return null;
    let startYear = Math.max(input.currentYear, Math.min(...years));
    if (acct.activationYear != null) startYear = Math.max(startYear, acct.activationYear);
    const endYear = Math.max(...years);
    if (endYear < startYear) return null;
    return { startYear, endYear, mode: "scheduled", annualAmount: 0, overrides };
  }

  if (policy.premiumAmount <= 0) return null;

  const issueYear = policy.termIssueYear ?? input.currentYear;
  let startYear =
    issueYear < input.currentYear ? input.currentYear : issueYear;
  if (acct.activationYear != null) startYear = Math.max(startYear, acct.activationYear);

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

  // endsAtInsuredRetirement is term-only (validated in the policy schema)
  // and means the policy stops at the insured's retirement year — cap
  // billing there even if premiumYears or the term-length fallback would
  // otherwise outlive retirement.
  if (policy.endsAtInsuredRetirement) {
    endYear = Math.min(endYear, resolveRetirementEndYear(acct, input));
  }

  // Guard against nonsensical ranges (e.g., endYear < startYear from a
  // back-dated term policy). No premium window in that case.
  if (endYear < startYear) return null;

  return {
    startYear,
    endYear,
    mode: "scalar",
    annualAmount: policy.premiumAmount,
    overrides: {},
  };
}

/**
 * Per-year premium amount for the resolved window. Scheduled years are clamped
 * to [startYear, endYear] so the gift stream matches what the expense bills.
 *
 * Consumed by both the expense path (indirectly via `synthesizePremiumExpenses`)
 * and `synthesizePremiumGifts` (the gift path), which guarantees the gift stream
 * matches the premium stream exactly.
 */
export function premiumAmountsByYear(
  r: ResolvedPremiumSchedule,
): Map<number, number> {
  const out = new Map<number, number>();
  if (r.mode === "scheduled") {
    for (const [y, amt] of Object.entries(r.overrides)) {
      const year = Number(y);
      if (year >= r.startYear && year <= r.endYear && amt > 0) out.set(year, amt);
    }
  } else {
    for (let y = r.startYear; y <= r.endYear; y++) out.set(y, r.annualAmount);
  }
  return out;
}

/**
 * Produces synthetic premium `Expense` rows for every life-insurance account
 * in `input.accounts` that has a billable premium. For each qualifying account,
 * delegates billing-window resolution to `resolvePremiumSchedule`, then
 * attaches `source = "policy"`, `sourcePolicyAccountId`, and the account's
 * `ownerEntityId` so entity-owned policies produce correctly scoped expenses.
 */
export function synthesizePremiumExpenses(
  input: SynthesizePremiumsInput,
): Expense[] {
  const out: Expense[] = [];

  for (const acct of input.accounts) {
    if (acct.category !== "life_insurance" || !acct.lifeInsurance) continue;
    const resolved = resolvePremiumSchedule(acct, input);
    if (!resolved) continue;

    if (input.giftContext) {
      const plan = planPremiumGift(acct, input.giftContext);
      if (plan && plan.recipient.kind === "individual") continue;
    }

    out.push({
      id: `premium-${acct.id}`,
      type: "insurance",
      name: `${acct.name} premium`,
      annualAmount: resolved.annualAmount,
      startYear: resolved.startYear,
      endYear: resolved.endYear,
      growthRate: 0,
      ...(resolved.mode === "scheduled"
        ? { scheduleOverrides: resolved.overrides }
        : {}),
      ownerEntityId: controllingEntity(acct) ?? undefined,
      source: "policy",
      sourcePolicyAccountId: acct.id,
    });
  }
  return out;
}

/**
 * Strip any previously-synthesized policy premium expenses and re-derive them
 * from the tree's CURRENT life-insurance accounts. Idempotent: running it on a
 * tree whose premiums are already current reproduces the same set.
 *
 * `synthesizePremiumExpenses` runs at base-load time on the BASE accounts, so
 * the scenario overlay (which can add / remove / edit life-insurance accounts)
 * would otherwise sit on top of stale or missing premiums. This re-derivation
 * runs on the EFFECTIVE tree after the overlay is applied; the synthesis inputs
 * (birth years, retirement ages, life expectancies) come from the tree's
 * (effective) client so scenario edits to those flow through too.
 */
export function withSynthesizedPremiums(tree: ClientData): ClientData {
  const nonPolicyExpenses = tree.expenses.filter((e) => e.source !== "policy");
  const { client } = tree;
  const clientBirthYear = parseInt(client.dateOfBirth.slice(0, 4), 10);
  const spouseBirthYear = client.spouseDob
    ? parseInt(client.spouseDob.slice(0, 4), 10)
    : null;
  const premiums = synthesizePremiumExpenses({
    currentYear: new Date().getFullYear(),
    accounts: tree.accounts,
    clientBirthYear,
    spouseBirthYear,
    clientRetirementAge: client.retirementAge,
    spouseRetirementAge: client.spouseRetirementAge ?? null,
    lifeExpectancyClient: client.lifeExpectancy ?? 0,
    lifeExpectancySpouse: client.spouseLifeExpectancy ?? null,
    giftContext: buildPremiumGiftContext(tree),
  });
  return { ...tree, expenses: [...nonPolicyExpenses, ...premiums] };
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

function resolveRetirementEndYear(
  acct: Account,
  input: SynthesizePremiumsInput,
): number {
  const insured = acct.insuredPerson ?? "client";
  const { clientBirthYear, spouseBirthYear, clientRetirementAge } = input;
  const spouseRetirementAge =
    input.spouseRetirementAge ?? input.clientRetirementAge;

  if (insured === "client") {
    return clientBirthYear + clientRetirementAge;
  }
  if (insured === "spouse") {
    return (spouseBirthYear ?? clientBirthYear) + spouseRetirementAge;
  }
  // joint — bill until the later of the two retirement years.
  const clientEnd = clientBirthYear + clientRetirementAge;
  const spouseEnd =
    (spouseBirthYear ?? clientBirthYear) + spouseRetirementAge;
  return Math.max(clientEnd, spouseEnd);
}
