import type {
  ClientData,
  ClientInfo,
  Account,
  Income,
  Expense,
  Liability,
  FamilyMember,
  SavingsRule,
  WithdrawalPriority,
  PlanSettings,
} from "../types";
import type { TaxYearParameters } from "../../lib/tax/types";
import { LEGACY_FM_CLIENT, LEGACY_FM_SPOUSE } from "../ownership";

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
    titlingType: "jtwros",
    value: 500000,
    basis: 500000,
    growthRate: 0.07,
    rmdEnabled: true,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
  },
  {
    id: "acct-roth",
    name: "Jane Roth IRA",
    category: "retirement",
    subType: "roth_ira",
    titlingType: "jtwros",
    value: 200000,
    basis: 150000,
    growthRate: 0.07,
    rmdEnabled: false,
    owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 1 }],
  },
  {
    id: "acct-brokerage",
    name: "Joint Brokerage",
    category: "taxable",
    subType: "brokerage",
    titlingType: "jtwros",
    value: 300000,
    basis: 200000,
    growthRate: 0.06,
    rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
  },
  {
    id: "acct-savings",
    name: "Emergency Fund",
    category: "cash",
    subType: "savings",
    titlingType: "jtwros",
    value: 50000,
    basis: 50000,
    growthRate: 0.04,
    rmdEnabled: false,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
  },
  {
    id: "acct-home",
    name: "Primary Home",
    category: "real_estate",
    subType: "primary_residence",
    titlingType: "jtwros",
    value: 750000,
    basis: 500000,
    growthRate: 0.04,
    rmdEnabled: false,
    annualPropertyTax: 12000,
    propertyTaxGrowthRate: 0.03,
    owners: [
      { kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 0.5 },
      { kind: "family_member", familyMemberId: LEGACY_FM_SPOUSE, percent: 0.5 },
    ],
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
    startMonth: 1,
    termMonths: 240,
    isInterestDeductible: true,
    extraPayments: [],
    owners: [],
  },
];

export const sampleSavingsRules: SavingsRule[] = [
  {
    id: "sav-401k",
    accountId: "acct-401k",
    annualAmount: 23500,
    isDeductible: true,
    startYear: 2026,
    endYear: 2035,
    employerMatchPct: 0.5,
    employerMatchCap: 0.06,
  },
];

export const sampleWithdrawalStrategy: WithdrawalPriority[] = [
  { accountId: "acct-savings", priorityOrder: 1, startYear: 2026, endYear: 2055 },
  { accountId: "acct-brokerage", priorityOrder: 2, startYear: 2026, endYear: 2055 },
  { accountId: "acct-401k", priorityOrder: 3, startYear: 2026, endYear: 2055 },
  { accountId: "acct-roth", priorityOrder: 4, startYear: 2026, endYear: 2055 },
];

/** Principal FMs with LEGACY sentinel IDs — needed for owner-resolution in
 *  employer-match, SS, and death-event tests that go through runProjection. */
export const sampleFamilyMembers: FamilyMember[] = [
  {
    id: LEGACY_FM_CLIENT,
    role: "client",
    relationship: "other",
    firstName: "John",
    lastName: "Smith",
    dateOfBirth: "1970-01-01",
  },
  {
    id: LEGACY_FM_SPOUSE,
    role: "spouse",
    relationship: "other",
    firstName: "Jane",
    lastName: "Smith",
    dateOfBirth: "1972-06-15",
  },
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
    familyMembers: sampleFamilyMembers,
    giftEvents: [],
    ...overrides,
  };
}

// ============================================================================
// Bracket-mode tax parameters
// ============================================================================
// One 2026 row; the resolver indexes later years off it. Shared by every test
// that needs the projection to run its BRACKET tax engine — without
// `taxYearRows` the projection warns and silently falls back to flat mode.
// Lives here, not in a *.test.ts file: importing one test file from another
// re-registers its whole suite inside the importer's run.
export const FIXTURE_TAX_PARAMS: TaxYearParameters[] = [{
  year: 2026,
  incomeBrackets: {
    married_joint: [
      { from: 0, to: 24800, rate: 0.10 },
      { from: 24800, to: 100800, rate: 0.12 },
      { from: 100800, to: null, rate: 0.22 },
    ],
    single: [{ from: 0, to: null, rate: 0.10 }],
    head_of_household: [{ from: 0, to: null, rate: 0.10 }],
    married_separate: [{ from: 0, to: null, rate: 0.10 }],
  },
  capGainsBrackets: {
    married_joint: { zeroPctTop: 94050, fifteenPctTop: 583750 },
    single: { zeroPctTop: 47025, fifteenPctTop: 518900 },
    head_of_household: { zeroPctTop: 63000, fifteenPctTop: 551350 },
    married_separate: { zeroPctTop: 47025, fifteenPctTop: 291850 },
  },
  trustIncomeBrackets: [],
  trustCapGainsBrackets: [],
  stdDeduction: { married_joint: 30000, single: 15000, head_of_household: 21900, married_separate: 15000 },
  amtExemption: { mfj: 137000, singleHoh: 88100, mfs: 68500 },
  amtBreakpoint2628: { mfjShoh: 239100, mfs: 119550 },
  amtPhaseoutStart: { mfj: 1237450, singleHoh: 618700, mfs: 618725 },
  ssTaxRate: 0.062,
  ssWageBase: 176100,
  medicareTaxRate: 0.0145,
  addlMedicareRate: 0.009,
  addlMedicareThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  niitRate: 0.038,
  niitThreshold: { mfj: 250000, single: 200000, mfs: 125000 },
  qbi: {
    thresholdMfj: 383900,
    thresholdSingleHohMfs: 191950,
    phaseInRangeMfj: 100000,
    phaseInRangeOther: 50000,
  },
  rothPhaseout: { startMfj: null, endMfj: null, startSingle: null, endSingle: null },
  iraDeduct: { coveredStartMfj: null, coveredEndMfj: null, coveredStartSingle: null,
               coveredEndSingle: null, spousalStartMfj: null, spousalEndMfj: null },
  studentLoan: { maxDeduction: null, startMfj: null, endMfj: null, startSingle: null, endSingle: null },
  ctc: { perChild: null, refundableMax: null, odcPerDependent: null },
  saversCredit: { mfj: [], single: [], hoh: [] },
  contribLimits: {
    ira401kElective: 23500,
    ira401kCatchup50: 7500,
    ira401kCatchup6063: 11250,
    iraTradLimit: 7000,
    iraCatchup50: 1000,
    simpleLimitRegular: 17000,
    simpleCatchup50: 4000,
    hsaLimitSelf: 4400,
    hsaLimitFamily: 8750,
    hsaCatchup55: 1000,
  },
}];
