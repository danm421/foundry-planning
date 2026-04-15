import type {
  ClientData,
  ClientInfo,
  Account,
  Income,
  Expense,
  Liability,
  SavingsRule,
  WithdrawalPriority,
  PlanSettings,
} from "../types";

export const baseClient: ClientInfo = {
  firstName: "John",
  lastName: "Smith",
  dateOfBirth: "1970-01-01",
  retirementAge: 65,
  planEndAge: 90,
  filingStatus: "married_joint",
  spouseName: "Jane Smith",
  spouseDob: "1972-06-15",
  spouseRetirementAge: 65,
};

export const basePlanSettings: PlanSettings = {
  flatFederalRate: 0.22,
  flatStateRate: 0.05,
  inflationRate: 0.03,
  planStartYear: 2026,
  planEndYear: 2055,
};

export const sampleAccounts: Account[] = [
  {
    id: "acct-401k",
    name: "John 401(k)",
    category: "retirement",
    subType: "401k",
    owner: "client",
    value: 500000,
    basis: 500000,
    growthRate: 0.07,
    rmdEnabled: true,
  },
  {
    id: "acct-roth",
    name: "Jane Roth IRA",
    category: "retirement",
    subType: "roth_ira",
    owner: "spouse",
    value: 200000,
    basis: 150000,
    growthRate: 0.07,
    rmdEnabled: false,
  },
  {
    id: "acct-brokerage",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    owner: "joint",
    value: 300000,
    basis: 200000,
    growthRate: 0.06,
    rmdEnabled: false,
  },
  {
    id: "acct-savings",
    name: "Emergency Fund",
    category: "cash",
    subType: "savings",
    owner: "joint",
    value: 50000,
    basis: 50000,
    growthRate: 0.04,
    rmdEnabled: false,
  },
];

export const sampleIncomes: Income[] = [
  {
    id: "inc-salary-john",
    type: "salary",
    name: "John Salary",
    annualAmount: 150000,
    startYear: 2026,
    endYear: 2035,
    growthRate: 0.03,
    owner: "client",
  },
  {
    id: "inc-salary-jane",
    type: "salary",
    name: "Jane Salary",
    annualAmount: 100000,
    startYear: 2026,
    endYear: 2037,
    growthRate: 0.03,
    owner: "spouse",
  },
  {
    id: "inc-ss-john",
    type: "social_security",
    name: "John SS",
    annualAmount: 36000,
    startYear: 2026,
    endYear: 2055,
    growthRate: 0.02,
    owner: "client",
    claimingAge: 67,
  },
];

export const sampleExpenses: Expense[] = [
  {
    id: "exp-living",
    type: "living",
    name: "Living Expenses",
    annualAmount: 80000,
    startYear: 2026,
    endYear: 2055,
    growthRate: 0.03,
  },
  {
    id: "exp-insurance",
    type: "insurance",
    name: "Life Insurance",
    annualAmount: 5000,
    startYear: 2026,
    endYear: 2045,
    growthRate: 0.02,
  },
];

export const sampleLiabilities: Liability[] = [
  {
    id: "liab-mortgage",
    name: "Mortgage",
    balance: 300000,
    interestRate: 0.065,
    monthlyPayment: 2500,
    startYear: 2026,
    endYear: 2046,
  },
];

export const sampleSavingsRules: SavingsRule[] = [
  {
    id: "sav-401k",
    accountId: "acct-401k",
    annualAmount: 23500,
    startYear: 2026,
    endYear: 2035,
    employerMatchPct: 0.5,
    employerMatchCap: 0.06,
    annualLimit: 23500,
  },
];

export const sampleWithdrawalStrategy: WithdrawalPriority[] = [
  { accountId: "acct-savings", priorityOrder: 1, startYear: 2026, endYear: 2055 },
  { accountId: "acct-brokerage", priorityOrder: 2, startYear: 2026, endYear: 2055 },
  { accountId: "acct-401k", priorityOrder: 3, startYear: 2026, endYear: 2055 },
  { accountId: "acct-roth", priorityOrder: 4, startYear: 2026, endYear: 2055 },
];

export function buildClientData(overrides?: Partial<ClientData>): ClientData {
  return {
    client: baseClient,
    accounts: sampleAccounts,
    incomes: sampleIncomes,
    expenses: sampleExpenses,
    liabilities: sampleLiabilities,
    savingsRules: sampleSavingsRules,
    withdrawalStrategy: sampleWithdrawalStrategy,
    planSettings: basePlanSettings,
    ...overrides,
  };
}
