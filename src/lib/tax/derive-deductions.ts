/**
 * Pure helpers that derive deduction inputs for the bracket tax engine.
 *
 * Six sources aggregate into a unified DeductionContribution:
 *   1. Savings rules → 401k/IRA above-line (existing)
 *   2. Expenses tagged with a deductionType
 *   3. Manual client_deductions rows
 *   4. Mortgage interest from liabilities with isInterestDeductible
 *   5. Real estate account property taxes
 *   6. Student-loan interest from `student` liabilities (IRC 221, above-line)
 *
 * All SALT contributions pool before a single statutory cap ($40k OBBBA 2026+,
 * $10k TCJA pre-2026). The cap is a flat dollar amount — no inflation.
 */

import type { FilingStatus, TaxYearParameters } from "./types";
import type { LiabilityType } from "@/engine/liability-kind";
import type { SuspensionWindow } from "@/engine/types";
import { studentLoanInterestDeduction, traditionalIraDeductibleAmount } from "./thresholds";

// ── Contribution interface ──────────────────────────────────────────────────

export interface DeductionContribution {
  aboveLine: number;
  itemized: number;
  saltPool: number;
}

// ── SALT cap ────────────────────────────────────────────────────────────────

export function saltCap(year: number): number {
  return year >= 2026 ? 40_000 : 10_000;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export function aggregateDeductions(
  year: number,
  ...contributions: DeductionContribution[]
): { aboveLine: number; itemized: number } {
  let aboveLine = 0;
  let itemized = 0;
  let salt = 0;

  for (const c of contributions) {
    aboveLine += c.aboveLine;
    itemized += c.itemized;
    salt += c.saltPool;
  }

  const cappedSalt = Math.min(salt, saltCap(year));
  return { aboveLine, itemized: itemized + cappedSalt };
}

// ── Source 1: Savings rules → above-line ────────────────────────────────────

/** Account subtypes whose contributions CAN be above-the-line deductible.
 *  Used by both the tax engine (to gate the deduction) and by the UI
 *  (to decide whether to render the deductibility checkbox). Eligibility
 *  additionally requires `account.category === "retirement"` and the rule's
 *  own `isDeductible` flag. */
export const DEDUCTIBLE_ELIGIBLE_SUBTYPES = new Set([
  "traditional_ira",
  "401k",
  "403b",
  "hsa",
  "other",
]);

export interface SavingsRuleForDeduction {
  id: string;
  accountId: string;
  annualAmount: number;
  /** When non-null, contribution resolves as salary × annualPercent. */
  annualPercent?: number | null;
  /** Per-rule deductibility flag. The derive function gates on this AND on
   *  subtype eligibility AND on retirement category. */
  isDeductible: boolean;
  /** Roth-designated fraction (0..1) of the contribution. The deduction
   *  counts only the pre-tax remainder. Absent → fully pre-tax. */
  rothPercent?: number | null;
  startYear: number;
  endYear: number;
}

/**
 * Which taxpayer a traditional-IRA contribution is attributed to for IRC
 * 219(g), which is a PER-INDIVIDUAL phase-out. There is no "joint" — an IRA is
 * individually owned by statute, and anything that does not resolve to the
 * spouse folds into the client. `iraOwnerKey` (engine/contribution-limits.ts)
 * is the single implementation of that mapping.
 */
export type IraOwnerKey = "client" | "spouse";

export interface AccountForDeduction {
  id: string;
  subType: string;
  /** Required so we can gate deductions on retirement accounts only —
   *  "other" is in DEDUCTIBLE_ELIGIBLE_SUBTYPES but only the retirement flavor
   *  of "other" counts. */
  category: string;
  ownerEntityId?: string | null;
  /** Whose §219(g) phase-out and §219(b) limit this account's traditional-IRA
   *  contributions run against. Defaults to the client when absent, matching
   *  `iraOwnerKey`'s treatment of an account with no single family-member
   *  owner. Only consulted for `traditional_ira`. */
  iraOwner?: IraOwnerKey;
}

/**
 * `DeductionContribution` plus the traditional-IRA slice, broken out.
 *
 * The caller needs the IRA subtotal to build `magiBase` — total income minus
 * every above-line deduction EXCEPT the traditional-IRA and student-loan ones
 * (IRC 219(g)(3)(A)). Re-deriving it outside this module would mean copying
 * six inclusion guards (retirement category, DEDUCTIBLE_ELIGIBLE_SUBTYPES, the
 * isDeductible/HSA split, the grantor check, the override resolution and the
 * Roth split) — so it is exposed here instead, from the one loop that already
 * computes it.
 *
 * The value is the UNGATED pre-tax contribution: it is what the IRC 219(g)
 * phase-out is applied TO, not what survives it. It is therefore identical on a
 * gated and an ungated call — only `aboveLine` moves.
 */
export type SavingsDeductionContribution = DeductionContribution & {
  traditionalIraPreTax: number;
  /**
   * Account ids that actually contributed to `traditionalIraPreTax` this year,
   * de-duplicated and split by owner. Exposed for exactly one reason: IRC
   * 219(g)(2)(A) reduces the §219(b) LIMIT, and that limit is PER PERSON — so
   * the caller has to know WHICH accounts (and hence which owners, and hence
   * which ages) are in play before it can build the limit basis to pass back
   * in as `iraGate.annualLimitByOwner`.
   *
   * It has to come from THIS loop rather than being re-derived by the caller:
   * inclusion here turns on six guards (retirement category,
   * DEDUCTIBLE_ELIGIBLE_SUBTYPES, the isDeductible/HSA split, the grantor-entity
   * check, the rule's own year window and a non-zero resolved amount) that do
   * NOT match the guard set `applyContributionLimits` uses. Deriving the basis
   * from that other guard set would bound these contributions with a limit
   * computed over a different set of people.
   *
   * The split matters for the same reason: the basis has to be priced over the
   * SAME buckets the contributions are gated in, or one owner's ceiling ends
   * up bounding the other's contribution.
   */
  traditionalIraAccountIdsByOwner: Record<IraOwnerKey, string[]>;
};

export function deriveAboveLineFromSavings(
  year: number,
  savingsRules: SavingsRuleForDeduction[],
  accounts: AccountForDeduction[],
  isGrantorEntity: (entityId: string) => boolean,
  // Optional per-rule salary base used to resolve percent-mode contributions
  // into a dollar amount. Keyed by rule id. Falls back to rule.annualAmount
  // when the rule is not in the map or has no percent set.
  salaryByRuleId?: Record<string, number>,
  // Optional pre-resolved (and possibly contribution-limit-capped) amount per
  // rule. When present, overrides the internal percent/annualAmount
  // resolution so the deduction reflects the capped contribution.
  overriddenAmountByRuleId?: Record<string, number>,
  // Optional IRC 219(g) MAGI phase-out inputs. Absent → traditional IRA
  // contributions are deducted in full, preserving pre-gate behaviour.
  iraGate?: {
    magi: number;
    coveredSelf: boolean;
    coveredSpouse: boolean;
    params: TaxYearParameters;
    filingStatus: FilingStatus;
    /**
     * The §219(b) annual IRA limit basis each taxpayer's traditional-IRA
     * contributions are measured against — the figure IRC 219(g)(2)(A) applies
     * that person's phase-out fraction TO. The caller prices the owners of
     * `traditionalIraAccountIdsByOwner` from a prior ungated call (see that
     * field's note).
     *
     * ⚠️ Each entry must be gated on whether THAT owner actually CONTRIBUTED.
     * Crediting a spouse who contributed nothing inflates their ceiling and
     * over-deducts — the mirror image of the contribution-basis bug this
     * parameter exists to fix.
     */
    annualLimitByOwner: Record<IraOwnerKey, number>;
  }
): SavingsDeductionContribution {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  let total = 0;
  // Traditional IRA contributions accumulate separately so the MAGI gate below
  // can be applied once per OWNER to their sum, rather than once per rule.
  // Everything else is never MAGI-limited.
  //
  // The household total is still tracked alongside the per-owner buckets: the
  // caller subtracts it to build `magiBase` (IRC 219(g)(3)(A) adds the IRA
  // deduction back), which is a household figure and not a per-owner one.
  let traditionalIraPreTax = 0;
  // IRC 219(g) is per INDIVIDUAL, so the traditional-IRA slice is bucketed by
  // owner rather than pooled: each spouse phases out their own §219(b) limit.
  const traditionalIraPreTaxByOwner: Record<IraOwnerKey, number> = { client: 0, spouse: 0 };
  const traditionalIraAccountIdsByOwner: Record<IraOwnerKey, Set<string>> = {
    client: new Set(),
    spouse: new Set(),
  };
  for (const rule of savingsRules) {
    if (year < rule.startYear || year > rule.endYear) continue;
    const acct = accountById.get(rule.accountId);
    if (!acct) continue;
    if (acct.category !== "retirement") continue;
    if (!DEDUCTIBLE_ELIGIBLE_SUBTYPES.has(acct.subType)) continue;
    // HSA contributions are above-the-line deductible by statute — there is no
    // per-account toggle for them. Other subtypes still gate on the rule flag.
    const isHsa = acct.subType === "hsa";
    if (!isHsa && !rule.isDeductible) continue;
    if (acct.ownerEntityId != null && !isGrantorEntity(acct.ownerEntityId)) continue;
    const overridden = overriddenAmountByRuleId?.[rule.id];
    let amount: number;
    if (overridden != null) {
      amount = overridden;
    } else {
      const salary = salaryByRuleId?.[rule.id] ?? 0;
      amount =
        rule.annualPercent != null && rule.annualPercent > 0 && salary > 0
          ? salary * rule.annualPercent
          : rule.annualAmount;
    }
    // When overridden, `amount` is the total (possibly capped) contribution —
    // the Roth split still applies to it to isolate the pre-tax portion.
    const preTax = amount * (1 - (rule.rothPercent ?? 0));
    if (acct.subType === "traditional_ira") {
      const owner = acct.iraOwner ?? "client";
      traditionalIraPreTax += preTax;
      traditionalIraPreTaxByOwner[owner] += preTax;
      // Only a non-zero contribution puts its owner's §219(b) limit into the
      // basis. A rule resolving to $0 (or wholly Roth-split) must NOT enlarge
      // the ceiling — see the warning on `iraGate.annualLimitByOwner`.
      if (preTax > 0) traditionalIraAccountIdsByOwner[owner].add(acct.id);
    } else total += preTax;
  }

  // ── IRC 219(g) traditional-IRA gate ──────────────────────────────────────
  // ONE call PER OWNER, because 219(g) is a per-individual phase-out:
  //
  //  - Each spouse's own contributions are measured against their own §219(b)
  //    limit. Pooling them lets a $1 contribution from one spouse buy a full
  //    extra $7,000 of ceiling for the other, since "did this owner
  //    contribute" is a threshold at $0 and not anything proportional. The two
  //    agree only when the contributions are homogeneous.
  //
  //  - `coveredSelf`/`coveredSpouse` are SWAPPED for the spouse's bucket:
  //    `traditionalIraDeductibleAmount` picks `iraDeductCovered` vs
  //    `iraDeductSpousal` from (own coverage, other's coverage), so "self" has
  //    to mean the owner being priced. A couple where only one spouse is an
  //    active workplace-plan participant now gets the two different ranges IRC
  //    219(g) gives them, instead of one range applied to both.
  //
  //  - Pub 590-A's $10 round-up / $200 floor therefore lands once per
  //    TAXPAYER, which is what §219(g)(2)(B) says. Contributions are still
  //    aggregated WITHIN an owner before their single call: gating per rule
  //    would apply the $200 floor once per RULE, so three small rules deep in
  //    the phase-out would deduct 3 x $200 instead of $200. The proportional
  //    reduction itself is linear, so aggregating within an owner is otherwise
  //    arithmetically identical.
  for (const owner of ["client", "spouse"] as const) {
    const contribution = traditionalIraPreTaxByOwner[owner];
    if (contribution === 0) continue;
    if (!iraGate) {
      total += contribution;
      continue;
    }
    const ownCovered = owner === "client" ? iraGate.coveredSelf : iraGate.coveredSpouse;
    const otherCovered = owner === "client" ? iraGate.coveredSpouse : iraGate.coveredSelf;
    total += traditionalIraDeductibleAmount(
      iraGate.magi,
      contribution,
      iraGate.annualLimitByOwner[owner],
      ownCovered,
      otherCovered,
      year,
      iraGate.params,
      iraGate.filingStatus
    );
  }

  return {
    aboveLine: total,
    itemized: 0,
    saltPool: 0,
    traditionalIraPreTax,
    traditionalIraAccountIdsByOwner: {
      client: [...traditionalIraAccountIdsByOwner.client],
      spouse: [...traditionalIraAccountIdsByOwner.spouse],
    },
  };
}

// ── Source 2: Expenses tagged with deductionType ────────────────────────────

export interface ExpenseForDeduction {
  deductionType?: "charitable" | "above_line" | "below_line" | "property_tax" | null;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  inflationStartYear?: number;
  /** Carried through from `Expense.suspended`. This module is the ONE expense
   *  consumer that does not run through `itemProrationGate` — it hand-copies
   *  the fields it needs and does its own window check below — so a hole in the
   *  row is invisible here unless it is copied across. No expense with a hole
   *  is deductible today; the field is here so the first one that is does not
   *  get deducted through its own suspension in silence. */
  suspended?: SuspensionWindow | null;
}

/** Same rule as `itemProrationGate`'s suspension check, applied to the narrowed
 *  deduction view of an expense. */
function activeInYear(exp: ExpenseForDeduction, year: number): boolean {
  if (year < exp.startYear || year > exp.endYear) return false;
  const hole = exp.suspended;
  if (!hole || year < hole.fromYear) return true;
  return hole.throughYear != null && year > hole.throughYear;
}

function inflateExpense(exp: ExpenseForDeduction, year: number): number {
  const baseYear = exp.inflationStartYear ?? exp.startYear;
  const elapsed = year - baseYear;
  return exp.annualAmount * Math.pow(1 + exp.growthRate, Math.max(0, elapsed));
}

export function deriveAboveLineFromExpenses(
  year: number,
  expenses: ExpenseForDeduction[]
): DeductionContribution {
  let total = 0;
  for (const exp of expenses) {
    if (exp.deductionType !== "above_line") continue;
    if (!activeInYear(exp, year)) continue;
    total += inflateExpense(exp, year);
  }
  return { aboveLine: total, itemized: 0, saltPool: 0 };
}

export function deriveItemizedFromExpenses(
  year: number,
  expenses: ExpenseForDeduction[]
): DeductionContribution {
  let itemized = 0;
  let saltPool = 0;
  for (const exp of expenses) {
    if (!exp.deductionType || exp.deductionType === "above_line") continue;
    if (!activeInYear(exp, year)) continue;
    const amount = inflateExpense(exp, year);
    if (exp.deductionType === "property_tax") {
      saltPool += amount;
    } else {
      itemized += amount;
    }
  }
  return { aboveLine: 0, itemized, saltPool };
}

// ── Source 3: Manual client_deductions rows ─────────────────────────────────

export interface ClientDeductionRow {
  type: "charitable" | "above_line" | "below_line" | "property_tax";
  annualAmount: number;
  growthRate: number;
  startYear: number;
  endYear: number;
}

export function sumItemizedFromEntries(
  year: number,
  rows: ClientDeductionRow[]
): DeductionContribution {
  let aboveLine = 0;
  let itemized = 0;
  let saltPool = 0;

  for (const row of rows) {
    if (year < row.startYear || year > row.endYear) continue;
    const yearsSinceStart = year - row.startYear;
    const inflated = row.annualAmount * Math.pow(1 + row.growthRate, yearsSinceStart);
    switch (row.type) {
      case "above_line":
        aboveLine += inflated;
        break;
      case "property_tax":
        saltPool += inflated;
        break;
      default: // charitable, below_line
        itemized += inflated;
        break;
    }
  }

  return { aboveLine, itemized, saltPool };
}

// ── Source 4: Mortgage interest from liabilities ────────────────────────────

export interface LiabilityForDeduction {
  id: string;
  isInterestDeductible: boolean;
  startYear: number;
  endYear: number;
}

export function deriveMortgageInterestFromLiabilities(
  year: number,
  liabilities: LiabilityForDeduction[],
  interestByLiability: Record<string, number>
): DeductionContribution {
  let total = 0;
  for (const liab of liabilities) {
    if (!liab.isInterestDeductible) continue;
    if (year < liab.startYear || year > liab.endYear) continue;
    total += interestByLiability[liab.id] ?? 0;
  }
  return { aboveLine: 0, itemized: total, saltPool: 0 };
}

// ── Source 5: Property taxes from real estate accounts ──────────────────────

export interface AccountForPropertyTax {
  id: string;
  name: string;
  category: string;
  annualPropertyTax: number;
  propertyTaxGrowthRate: number;
}

export function derivePropertyTaxFromAccounts(
  year: number,
  accounts: AccountForPropertyTax[],
  planStartYear: number
): DeductionContribution {
  let total = 0;
  for (const acct of accounts) {
    if (acct.category !== "real_estate") continue;
    if (acct.annualPropertyTax <= 0) continue;
    const elapsed = year - planStartYear;
    total += acct.annualPropertyTax * Math.pow(1 + acct.propertyTaxGrowthRate, Math.max(0, elapsed));
  }
  return { aboveLine: 0, itemized: 0, saltPool: total };
}

// ── Source 6: Student-loan interest from liabilities ────────────────────────

export interface StudentLoanForDeduction {
  id: string;
  liabilityType?: LiabilityType | null;
}

/**
 * IRC 221 student-loan interest — an ABOVE-the-line adjustment, unlike the
 * itemized mortgage interest in source 4. Two consequences of that statutory
 * difference show up here:
 *
 *  1. No `isInterestDeductible` gate. That flag drives the itemized mortgage
 *     path; student-loan interest is deductible by statute, not by user toggle.
 *  2. The cap and phase-out are per RETURN, so every student liability's
 *     interest is summed FIRST and gated with a single call. Gating per
 *     liability would let a household with three loans deduct three caps.
 *
 * MFS denial and the null-cap case both live in `studentLoanInterestDeduction`
 * — deliberately not re-derived here, since inferring MFS from the range
 * sentinel is exactly backwards (see that function's docblock).
 *
 * `year` is forwarded to the gate for its year-aware range lookup. There is no
 * per-liability year filter as in source 4: the caller already hands us one
 * year's liabilities and one year's interest accruals.
 */
export function deriveStudentLoanInterest(
  year: number,
  liabilities: StudentLoanForDeduction[],
  interestByLiability: Record<string, number>,
  magi: number,
  params: TaxYearParameters,
  filingStatus: FilingStatus
): DeductionContribution {
  let interestPaid = 0;
  for (const liab of liabilities) {
    if (liab.liabilityType !== "student") continue;
    interestPaid += interestByLiability[liab.id] ?? 0;
  }
  return {
    aboveLine: studentLoanInterestDeduction(interestPaid, magi, year, params, filingStatus),
    itemized: 0,
    saltPool: 0,
  };
}
