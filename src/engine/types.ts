import type { TaxResult, TaxYearParameters } from "../lib/tax/types";
import type { ClientDeductionRow } from "../lib/tax/derive-deductions";

// ── Input Types ──────────────────────────────────────────────────────────────

export interface ClientData {
  client: ClientInfo;
  accounts: Account[];
  incomes: Income[];
  expenses: Expense[];
  liabilities: Liability[];
  savingsRules: SavingsRule[];
  withdrawalStrategy: WithdrawalPriority[];
  planSettings: PlanSettings;
  entities?: EntitySummary[];
  /** IRS-published tax year parameters seeded from the DB. Empty = flat-mode fallback. */
  taxYearRows?: TaxYearParameters[];
  /** Itemized deduction line items (charitable, SALT, mortgage interest, etc.). */
  deductions?: ClientDeductionRow[];
}

// Minimal entity view used by the engine to decide cash-flow treatment of entity-owned
// accounts, incomes, expenses, and liabilities.
export interface EntitySummary {
  id: string;
  // When true, the entity's accounts are rolled into the household's portfolio assets view.
  includeInPortfolio: boolean;
  // When true, taxes on the entity's income and RMDs are paid at the household rate.
  isGrantor: boolean;
}

export interface ClientInfo {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  retirementAge: number;
  planEndAge: number;
  spouseName?: string;
  spouseDob?: string;
  spouseRetirementAge?: number;
  filingStatus: "single" | "married_joint" | "married_separate" | "head_of_household";
}

export interface Account {
  id: string;
  name: string;
  category: "taxable" | "cash" | "retirement" | "real_estate" | "business" | "life_insurance";
  subType: string;
  owner: "client" | "spouse" | "joint";
  value: number;
  basis: number;
  growthRate: number;
  rmdEnabled: boolean;
  ownerEntityId?: string;
  isDefaultChecking?: boolean;
  annualPropertyTax?: number;
  propertyTaxGrowthRate?: number;
  // CMA realization model — present when account uses a model portfolio or has overrides
  realization?: {
    pctOrdinaryIncome: number;
    pctLtCapitalGains: number;
    pctQualifiedDividends: number;
    pctTaxExempt: number;
    turnoverPct: number;
  };
}

export interface Income {
  id: string;
  type: "salary" | "social_security" | "business" | "deferred" | "capital_gains" | "trust" | "other";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  /**
   * Year from which inflation compounds. When set and earlier than startYear,
   * annualAmount is treated as a today's-dollars amount and the engine grows it
   * through the gap. Null → compound only from startYear (current-dollar amount).
   */
  inflationStartYear?: number;
  owner: "client" | "spouse" | "joint";
  claimingAge?: number;
  linkedEntityId?: string;
  ownerEntityId?: string;
  // Cash account this income deposits into. When unset, the engine falls back to the
  // household default checking (or the entity's default checking if ownerEntityId is set).
  cashAccountId?: string;
  taxType?: "earned_income" | "ordinary_income" | "dividends" | "capital_gains" | "qbi" | "tax_exempt" | "stcg";
}

export interface Expense {
  id: string;
  type: "living" | "other" | "insurance";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  /** See Income.inflationStartYear. */
  inflationStartYear?: number;
  ownerEntityId?: string;
  // Cash account this expense is paid from.
  cashAccountId?: string;
  deductionType?: "charitable" | "above_line" | "below_line" | "property_tax" | null;
}

export interface Liability {
  id: string;
  name: string;
  balance: number;
  interestRate: number;
  monthlyPayment: number;
  startYear: number;
  endYear: number;
  linkedPropertyId?: string;
  ownerEntityId?: string;
  isInterestDeductible?: boolean;
}

export interface SavingsRule {
  id: string;
  accountId: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  employerMatchPct?: number;
  employerMatchCap?: number;
  /** Flat annual dollar amount. When set, overrides the percentage/cap style. */
  employerMatchAmount?: number;
  annualLimit?: number;
}

export interface WithdrawalPriority {
  accountId: string;
  priorityOrder: number;
  startYear: number;
  endYear: number;
}

export interface PlanSettings {
  flatFederalRate: number;
  flatStateRate: number;
  inflationRate: number;
  planStartYear: number;
  planEndYear: number;
  /** "flat" (default) uses flatFederalRate; "bracket" routes through the bracket engine. */
  taxEngineMode?: "flat" | "bracket";
  /** Annual rate for inflating tax brackets/thresholds beyond the last seeded year. */
  taxInflationRate?: number;
  /** Annual rate for inflating the SS wage base (default: inflationRate + 0.005). */
  ssWageGrowthRate?: number;
}

// ── Output Types ─────────────────────────────────────────────────────────────

export interface ProjectionYear {
  year: number;
  ages: { client: number; spouse?: number };

  income: {
    salaries: number;
    socialSecurity: number;
    business: number;
    trust: number;
    deferred: number;
    capitalGains: number;
    other: number;
    total: number;
    bySource: Record<string, number>;
  };

  taxDetail?: {
    earnedIncome: number;
    ordinaryIncome: number;
    dividends: number;
    capitalGains: number;
    stCapitalGains: number;
    qbi: number;
    taxExempt: number;
    bySource: Record<string, { type: string; amount: number }>;
  };

  taxResult?: TaxResult;

  withdrawals: {
    byAccount: Record<string, number>;
    total: number;
  };

  expenses: {
    living: number;
    liabilities: number;
    other: number;
    insurance: number;
    realEstate: number;
    taxes: number;
    total: number;
    bySource: Record<string, number>;
  };

  savings: {
    byAccount: Record<string, number>;
    total: number;
    employerTotal: number;
  };

  totalIncome: number;
  totalExpenses: number;
  netCashFlow: number;

  portfolioAssets: {
    taxable: Record<string, number>;
    cash: Record<string, number>;
    retirement: Record<string, number>;
    realEstate: Record<string, number>;
    business: Record<string, number>;
    lifeInsurance: Record<string, number>;
    taxableTotal: number;
    cashTotal: number;
    retirementTotal: number;
    realEstateTotal: number;
    businessTotal: number;
    lifeInsuranceTotal: number;
    total: number;
  };

  accountLedgers: Record<string, AccountLedger>;
}

export interface AccountLedger {
  beginningValue: number;
  growth: number;
  contributions: number;
  distributions: number;
  rmdAmount: number;
  fees: number;
  endingValue: number;
  /**
   * Itemized entries for everything that happened in this account this year,
   * in the order it was applied. Amounts are signed: positive = inflow, negative = outflow.
   */
  entries: AccountLedgerEntry[];
  growthDetail?: {
    ordinaryIncome: number;
    qualifiedDividends: number;
    stCapitalGains: number;
    ltCapitalGains: number;
    taxExempt: number;
    basisIncrease: number;
  };
}

export interface AccountLedgerEntry {
  category:
    | "growth"
    | "income"
    | "rmd"
    | "expense"
    | "liability"
    | "tax"
    | "savings_contribution"
    | "employer_match"
    | "withdrawal"
    | "withdrawal_tax";
  label: string;
  amount: number;
  sourceId?: string;
}
