/**
 * Pure helpers that derive deduction inputs for the bracket tax engine.
 *
 * Five sources aggregate into a unified DeductionContribution:
 *   1. Savings rules → 401k/IRA above-line (existing)
 *   2. Expenses tagged with a deductionType
 *   3. Manual client_deductions rows
 *   4. Mortgage interest from liabilities with isInterestDeductible
 *   5. Real estate account property taxes
 *
 * All SALT contributions pool before a single statutory cap ($40k OBBBA 2026+,
 * $10k TCJA pre-2026). The cap is a flat dollar amount — no inflation.
 */

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
  salaryByRuleId?: Record<string, number>
): DeductionContribution {
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  let total = 0;
  for (const rule of savingsRules) {
    if (year < rule.startYear || year > rule.endYear) continue;
    if (!rule.isDeductible) continue;
    const acct = accountById.get(rule.accountId);
    if (!acct) continue;
    if (acct.category !== "retirement") continue;
    if (!DEDUCTIBLE_ELIGIBLE_SUBTYPES.has(acct.subType)) continue;
    if (acct.ownerEntityId != null && !isGrantorEntity(acct.ownerEntityId)) continue;
    const salary = salaryByRuleId?.[rule.id] ?? 0;
    const amount =
      rule.annualPercent != null && rule.annualPercent > 0 && salary > 0
        ? salary * rule.annualPercent
        : rule.annualAmount;
    total += amount;
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
