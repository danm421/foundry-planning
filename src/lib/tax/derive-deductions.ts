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

export interface AccountForDeduction {
  id: string;
  subType: string;
  /** Required so we can gate deductions on retirement accounts only —
   *  "other" is in DEDUCTIBLE_ELIGIBLE_SUBTYPES but only the retirement flavor
   *  of "other" counts. */
  category: string;
  ownerEntityId?: string | null;
}

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
  }
): DeductionContribution {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  let total = 0;
  // Traditional IRA contributions accumulate separately so the MAGI gate below
  // can be applied ONCE to their sum. Everything else is never MAGI-limited.
  let traditionalIraPreTax = 0;
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
    if (acct.subType === "traditional_ira") traditionalIraPreTax += preTax;
    else total += preTax;
  }

  // ── IRC 219(g) traditional-IRA gate ──────────────────────────────────────
  // Two limitations, both consequences of what this module can see:
  //
  //  1. Owner identity is unavailable here. `AccountForDeduction` carries no
  //     family member, and `iraGate` supplies a single household-level
  //     coveredSelf/coveredSpouse pair. So a married couple where only one
  //     spouse is an active workplace-plan participant gets ONE phase-out
  //     range applied to their combined contributions, whereas IRC 219(g)
  //     gives the covered and the non-covered spouse different ranges
  //     (`iraDeductCovered` vs `iraDeductSpousal`). Resolving it needs either
  //     owner information in this module or two separate calls — deferred.
  //
  //  2. Pub 590-A's $10 round-up / $200 floor is therefore applied once per
  //     HOUSEHOLD, not once per taxpayer. Contributions are aggregated before
  //     the single call on purpose: gating per rule would apply the $200 floor
  //     once per RULE, so three small rules deep in the phase-out would deduct
  //     3 x $200 instead of $200. The proportional reduction itself is linear,
  //     so aggregating is otherwise arithmetically identical.
  if (traditionalIraPreTax !== 0) {
    total += iraGate
      ? traditionalIraDeductibleAmount(
          iraGate.magi,
          traditionalIraPreTax,
          iraGate.coveredSelf,
          iraGate.coveredSpouse,
          year,
          iraGate.params,
          iraGate.filingStatus
        )
      : traditionalIraPreTax;
  }

  return { aboveLine: total, itemized: 0, saltPool: 0 };
}

// ── Source 2: Expenses tagged with deductionType ────────────────────────────

export interface ExpenseForDeduction {
  deductionType?: "charitable" | "above_line" | "below_line" | "property_tax" | null;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  inflationStartYear?: number;
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
    if (year < exp.startYear || year > exp.endYear) continue;
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
    if (year < exp.startYear || year > exp.endYear) continue;
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
