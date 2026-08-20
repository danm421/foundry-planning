// Which accounts the report treats as payroll deferrals — the accounts a
// "save 3% more" instruction can actually move, and the salary base the engine
// resolves each of them against.
//
// A rule already in percent-of-salary mode is a deferral by definition. A
// flat-dollar rule is converted to its implied percent so a client whose
// 401(k) was entered as "$1,000/month" still gets a ladder. A "contribute the
// annual maximum" rule is a deferral too — real dollars, and the sheet before
// the ladder reports them — but it carries no rate, so the ladder can name it
// without pretending to raise it.

import type { ClientData } from "@/engine/types";
// The ONE value import from the engine this file allows itself. `ownership.ts`
// is a leaf — its only import is a type — so nothing of the projection follows
// it into the browser bundle the registry reaches this module from. Copying
// the six lines instead would be worse: a hand-copy of an engine expression is
// exactly what goes stale without a test noticing.
import { controllingFamilyMember } from "@/engine/ownership";
import { activeIncomes } from "@/lib/solver/active-incomes";

export interface DeferralAccount {
  accountId: string;
  /** The rate the engine resolves this account's contribution at, denominated
   *  in the OWNER's salary — the same base `savings-annual-percent` writes into
   *  and the projection reads back. Zero for a `contributesMax` account, which
   *  has no rate at all. */
  currentPercent: number;
  /** The salary slice the engine divides this account's percent into. Zero
   *  when no individual salary grounds it (a jointly or entity-owned account). */
  ownerSalary: number;
  /** How many savings rules feed this account in the given year. */
  ruleCount: number;
  /** A rule on this account contributes the applicable IRS maximum. */
  contributesMax: boolean;
}

/**
 * One entry per ACCOUNT, not per rule.
 *
 * The ladder moves an account with the `savings-annual-percent` mutation, and
 * `applyMutations` sets that percent on EVERY rule sharing the accountId, so
 * only single-rule accounts are movable — see `isMovable`. `year` filters on
 * each rule's own start/end window: a rule that begins in 2032 is not a
 * deferral the client is making now.
 */
export function deferralAccounts(data: ClientData, year: number): DeferralAccount[] {
  const bases = salaryBases(data, year);
  const byAccount = new Map<string, DeferralAccount>();

  for (const rule of data.savingsRules ?? []) {
    if (rule.startYear > year || rule.endYear < year) continue;

    const ownerSalary = bases.byAccountId.get(rule.accountId) ?? bases.household;
    // `contributeMax` overrides both other modes in the engine
    // (`projection.ts` resolves it before it looks at percent or amount), so a
    // flat amount or a percent sitting on the same rule is dead data. Reading
    // it was how a $10,000 field that funds nothing became a phantom 2% on the
    // ladder.
    const contributesMax = rule.contributeMax === true;
    let percent = 0;
    if (!contributesMax) {
      if (rule.annualPercent != null && rule.annualPercent > 0) {
        percent = rule.annualPercent;
      } else if (ownerSalary > 0 && rule.annualAmount > 0) {
        percent = rule.annualAmount / ownerSalary;
      }
      // A rule that funds nothing this year is not a deferral to report.
      if (percent === 0) continue;
    }

    const existing = byAccount.get(rule.accountId);
    if (existing) {
      existing.currentPercent += percent;
      existing.ruleCount += 1;
      existing.contributesMax ||= contributesMax;
    } else {
      byAccount.set(rule.accountId, {
        accountId: rule.accountId,
        currentPercent: percent,
        ownerSalary,
        ruleCount: 1,
        contributesMax,
      });
    }
  }

  return [...byAccount.values()];
}

/**
 * Whether the ladder can actually move this account.
 *
 * - `applyMutations` writes `savings-annual-percent` onto EVERY rule sharing
 *   the account id, so a two-rule account would defer twice the target.
 * - The engine resolves `contributeMax` before any percent, so writing one
 *   onto a maxed-out rule changes nothing and every rung re-runs one plan.
 * - A percent needs a salary to be a percent OF.
 */
export function isMovable(a: DeferralAccount): boolean {
  return a.ruleCount === 1 && !a.contributesMax && a.ownerSalary > 0;
}

/** Gross personal salary the household earns in `year` — the denominator the
 *  household's savings rate is quoted against. */
export function householdSalary(data: ClientData, year: number): number {
  return salaryBases(data, year).household;
}

interface SalaryBases {
  household: number;
  /** Per ACCOUNT, the salary the engine resolves that account's percent rules
   *  against. Absent accounts fall back to the household total. */
  byAccountId: Map<string, number>;
}

/**
 * Mirrors `salaryByRuleId` in `src/engine/projection.ts` — the salary the
 * engine divides a percent-mode contribution into.
 *
 * It has to be the engine's base and not the household total. A spouse's "10%"
 * is 10% of the SPOUSE's pay, so a ladder that raised it as though it were a
 * share of household income would move the household by a fraction of the rung
 * it labels the bar with.
 *
 * One deliberate difference: the engine also runs each salary through
 * `itemProrationGate`, which drops a salary that has already stopped. This
 * resolves at the plan's FIRST year, where `activeIncomes`' own window filter
 * covers every case except a client retiring inside that first year.
 *
 * NOT `savingsRuleOwnerForAccount` (`src/lib/milestones.ts`), which looks like
 * the same lookup: it collapses "jointly owned" and "no family members on the
 * tree" both to "joint", and the engine gives those two 0 and the household
 * total respectively.
 */
function salaryBases(data: ClientData, year: number): SalaryBases {
  const byOwner = { client: 0, spouse: 0, joint: 0 };
  for (const inc of activeIncomes(data.incomes ?? [], year)) {
    // Salary rows only — a payroll deferral comes out of pay, not out of
    // business or trust income. Entity-owned salary is not personal pay.
    if (inc.type !== "salary") continue;
    if (inc.ownerEntityId != null) continue;
    const from = inc.inflationStartYear ?? inc.startYear;
    const amount = inc.annualAmount * Math.pow(1 + inc.growthRate, year - from);
    const key = inc.owner === "client" || inc.owner === "spouse" ? inc.owner : "joint";
    byOwner[key] += amount;
  }
  const household = byOwner.client + byOwner.spouse + byOwner.joint;

  const members = data.familyMembers ?? [];
  const clientFmId = members.find((fm) => fm.role === "client")?.id ?? null;
  const spouseFmId = members.find((fm) => fm.role === "spouse")?.id ?? null;

  const byAccountId = new Map<string, number>();
  for (const acct of data.accounts ?? []) {
    const owner = controllingFamilyMember(acct);
    if (spouseFmId != null && owner === spouseFmId) {
      byAccountId.set(acct.id, byOwner.spouse);
    } else if (clientFmId != null && owner === clientFmId) {
      byAccountId.set(acct.id, byOwner.client);
    } else if (owner == null && (clientFmId != null || spouseFmId != null)) {
      // Jointly or entity-owned: no individual salary grounds a percent here,
      // and the engine returns 0 for the same reason.
      byAccountId.set(acct.id, 0);
    } else {
      // Legacy trees with no family members — the engine's own fallback.
      byAccountId.set(acct.id, household);
    }
  }
  return { household, byAccountId };
}
