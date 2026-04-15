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
}

export interface Income {
  id: string;
  type: "salary" | "social_security" | "business" | "deferred" | "capital_gains" | "trust" | "other";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  owner: "client" | "spouse" | "joint";
  claimingAge?: number;
  linkedEntityId?: string;
  ownerEntityId?: string;
}

export interface Expense {
  id: string;
  type: "living" | "other" | "insurance";
  name: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  growthRate: number;
  ownerEntityId?: string;
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
}

export interface SavingsRule {
  id: string;
  accountId: string;
  annualAmount: number;
  startYear: number;
  endYear: number;
  employerMatchPct?: number;
  employerMatchCap?: number;
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

  withdrawals: {
    byAccount: Record<string, number>;
    total: number;
  };

  expenses: {
    living: number;
    liabilities: number;
    other: number;
    insurance: number;
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
}
