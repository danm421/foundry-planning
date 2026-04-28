/**
 * Pure-TypeScript fixture rows shaped like Drizzle's $inferSelect output.
 * - Decimal columns are strings (Drizzle returns pg numerics as strings)
 * - camelCase column keys matching Drizzle schema aliases
 * - Timestamps are Date objects
 *
 * Used by load-client-data.test.ts to drive the mock db without a DB connection.
 */

const NOW = new Date("2026-01-01T00:00:00Z");

export const FIXTURE_FIRM_ID = "fixture-firm-001";
export const FIXTURE_CLIENT_ID = "00000000-0000-0000-0000-000000000001";
export const FIXTURE_SCENARIO_ID = "00000000-0000-0000-0000-000000000010";
export const FIXTURE_ACCOUNT_ID_1 = "00000000-0000-0000-0000-000000000020";
export const FIXTURE_ACCOUNT_ID_2 = "00000000-0000-0000-0000-000000000021";
export const FIXTURE_PLAN_SETTINGS_ID = "00000000-0000-0000-0000-000000000030";
export const FIXTURE_INCOME_ID = "00000000-0000-0000-0000-000000000040";
export const FIXTURE_EXPENSE_ID = "00000000-0000-0000-0000-000000000050";
export const FIXTURE_LIABILITY_ID = "00000000-0000-0000-0000-000000000060";
export const FIXTURE_SAVINGS_RULE_ID = "00000000-0000-0000-0000-000000000070";
export const FIXTURE_ASSET_CLASS_ID = "00000000-0000-0000-0000-000000000080";
export const FIXTURE_ASSET_CLASS_INFLATION_ID = "00000000-0000-0000-0000-000000000081";
export const FIXTURE_PORTFOLIO_ID = "00000000-0000-0000-0000-000000000090";
export const FIXTURE_ALLOC_ID = "00000000-0000-0000-0000-000000000091";
export const FIXTURE_FAMILY_MEMBER_ID = "00000000-0000-0000-0000-000000000100";
export const FIXTURE_EXTERNAL_BENE_ID = "00000000-0000-0000-0000-000000000110";
export const FIXTURE_WILL_ID = "00000000-0000-0000-0000-000000000120";
export const FIXTURE_BEQUEST_ID = "00000000-0000-0000-0000-000000000121";
export const FIXTURE_BEQUEST_RECIPIENT_ID = "00000000-0000-0000-0000-000000000122";
export const FIXTURE_TAX_YEAR_ID = "00000000-0000-0000-0000-000000000200";
export const FIXTURE_TRANSFER_ID = "00000000-0000-0000-0000-000000000300";
export const FIXTURE_ACCOUNT_ID_3 = "00000000-0000-0000-0000-000000000022";
export const FIXTURE_ACCOUNT_ASSET_ALLOC_ID = "00000000-0000-0000-0000-000000000092";
export const FIXTURE_CORRELATION_ID = "00000000-0000-0000-0000-000000000400";
export const WRONG_FIRM_ID = "wrong-firm-999";

// ── clients ──────────────────────────────────────────────────────────────────

export const clientRow = {
  id: FIXTURE_CLIENT_ID,
  firmId: FIXTURE_FIRM_ID,
  advisorId: "advisor-001",
  firstName: "Alice",
  lastName: "Sample",
  dateOfBirth: "1968-06-15",
  retirementAge: 65,
  planEndAge: 95,
  lifeExpectancy: 95,
  spouseName: "Bob",
  spouseLastName: "Sample",
  spouseDob: "1970-03-22",
  spouseRetirementAge: 65,
  spouseLifeExpectancy: 92,
  filingStatus: "married_joint" as const,
  email: "alice@example.com",
  address: null,
  spouseEmail: null,
  spouseAddress: null,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── scenarios ─────────────────────────────────────────────────────────────────

export const scenarioRow = {
  id: FIXTURE_SCENARIO_ID,
  clientId: FIXTURE_CLIENT_ID,
  name: "Base Case",
  isBaseCase: true,
  monteCarloSeed: null,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── plan_settings ─────────────────────────────────────────────────────────────

export const planSettingsRow = {
  id: FIXTURE_PLAN_SETTINGS_ID,
  clientId: FIXTURE_CLIENT_ID,
  scenarioId: FIXTURE_SCENARIO_ID,
  flatFederalRate: "0.2200",
  flatStateRate: "0.0500",
  estateAdminExpenses: "0.00",
  flatStateEstateRate: "0.0000",
  taxEngineMode: "bracket" as const,
  taxInflationRate: null,
  ssWageGrowthRate: null,
  inflationRate: "0.0300",
  planStartYear: 2026,
  planEndYear: 2063,
  defaultGrowthTaxable: "0.0700",
  defaultGrowthCash: "0.0200",
  defaultGrowthRetirement: "0.0700",
  defaultGrowthRealEstate: "0.0400",
  defaultGrowthBusiness: "0.0500",
  defaultGrowthLifeInsurance: "0.0300",
  growthSourceTaxable: "custom" as const,
  modelPortfolioIdTaxable: null,
  growthSourceCash: "custom" as const,
  modelPortfolioIdCash: null,
  growthSourceRetirement: "custom" as const,
  modelPortfolioIdRetirement: null,
  selectedBenchmarkPortfolioId: null,
  inflationRateSource: "custom" as const,
  useCustomCma: false,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── asset_classes ─────────────────────────────────────────────────────────────

export const assetClassRow = {
  id: FIXTURE_ASSET_CLASS_ID,
  firmId: FIXTURE_FIRM_ID,
  name: "US Equity",
  slug: "us-equity",
  geometricReturn: "0.0700",
  arithmeticMean: "0.0850",
  volatility: "0.1500",
  pctOrdinaryIncome: "0.0000",
  pctLtCapitalGains: "0.8500",
  pctQualifiedDividends: "0.1500",
  pctTaxExempt: "0.0000",
  sortOrder: 1,
  assetType: "equity",
  createdAt: NOW,
  updatedAt: NOW,
};

export const inflationAssetClassRow = {
  id: FIXTURE_ASSET_CLASS_INFLATION_ID,
  firmId: FIXTURE_FIRM_ID,
  name: "Inflation",
  slug: "inflation",
  geometricReturn: "0.0300",
  arithmeticMean: "0.0300",
  volatility: "0.0100",
  pctOrdinaryIncome: "0.0000",
  pctLtCapitalGains: "0.0000",
  pctQualifiedDividends: "0.0000",
  pctTaxExempt: "0.0000",
  sortOrder: 0,
  assetType: "other",
  createdAt: NOW,
  updatedAt: NOW,
};

// ── model_portfolios ──────────────────────────────────────────────────────────

export const modelPortfolioRow = {
  id: FIXTURE_PORTFOLIO_ID,
  firmId: FIXTURE_FIRM_ID,
  name: "60/40",
  description: null,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── model_portfolio_allocations ───────────────────────────────────────────────

export const modelPortfolioAllocationRow = {
  id: FIXTURE_ALLOC_ID,
  modelPortfolioId: FIXTURE_PORTFOLIO_ID,
  assetClassId: FIXTURE_ASSET_CLASS_ID,
  weight: "1.0000",
};

// ── accounts ──────────────────────────────────────────────────────────────────

export const accountRows = [
  {
    id: FIXTURE_ACCOUNT_ID_1,
    clientId: FIXTURE_CLIENT_ID,
    scenarioId: FIXTURE_SCENARIO_ID,
    name: "Joint Brokerage",
    category: "taxable" as const,
    subType: "brokerage" as const,
    owner: "joint" as const,
    value: "250000.00",
    basis: "180000.00",
    growthRate: "0.0700",
    rmdEnabled: false,
    isDefaultChecking: false,
    ownerEntityId: null,
    ownerFamilyMemberId: null,
    growthSource: "custom" as const,
    modelPortfolioId: null,
    turnoverPct: "0.1000",
    overridePctOi: null,
    overridePctLtCg: null,
    overridePctQdiv: null,
    overridePctTaxExempt: null,
    annualPropertyTax: "0.00",
    propertyTaxGrowthRate: "0.0300",
    source: "manual" as const,
    createdAt: NOW,
    updatedAt: NOW,
  },
  {
    id: FIXTURE_ACCOUNT_ID_2,
    clientId: FIXTURE_CLIENT_ID,
    scenarioId: FIXTURE_SCENARIO_ID,
    name: "Checking",
    category: "cash" as const,
    subType: "checking" as const,
    owner: "joint" as const,
    value: "30000.00",
    basis: "30000.00",
    growthRate: "0.0200",
    rmdEnabled: false,
    isDefaultChecking: true,
    ownerEntityId: null,
    ownerFamilyMemberId: null,
    growthSource: "custom" as const,
    modelPortfolioId: null,
    turnoverPct: "0.0000",
    overridePctOi: null,
    overridePctLtCg: null,
    overridePctQdiv: null,
    overridePctTaxExempt: null,
    annualPropertyTax: "0.00",
    propertyTaxGrowthRate: "0.0300",
    source: "manual" as const,
    createdAt: NOW,
    updatedAt: NOW,
  },
];

// ── incomes ───────────────────────────────────────────────────────────────────

export const incomeRow = {
  id: FIXTURE_INCOME_ID,
  clientId: FIXTURE_CLIENT_ID,
  scenarioId: FIXTURE_SCENARIO_ID,
  type: "salary" as const,
  name: "Alice Salary",
  annualAmount: "150000.00",
  startYear: 2026,
  endYear: 2033,
  startYearRef: null,
  endYearRef: null,
  growthRate: "0.0300",
  growthSource: "custom" as const,
  inflationStartYear: null,
  owner: "client" as const,
  claimingAge: null,
  linkedEntityId: null,
  ownerEntityId: null,
  cashAccountId: null,
  taxType: "earned_income" as const,
  ssBenefitMode: null,
  piaMonthly: null,
  claimingAgeMonths: 0,
  claimingAgeMode: null,
  source: "manual" as const,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── expenses ──────────────────────────────────────────────────────────────────

export const expenseRow = {
  id: FIXTURE_EXPENSE_ID,
  clientId: FIXTURE_CLIENT_ID,
  scenarioId: FIXTURE_SCENARIO_ID,
  type: "living" as const,
  name: "Living Expenses",
  annualAmount: "80000.00",
  startYear: 2026,
  endYear: 2063,
  startYearRef: null,
  endYearRef: null,
  growthRate: "0.0300",
  growthSource: "custom" as const,
  inflationStartYear: null,
  ownerEntityId: null,
  cashAccountId: null,
  deductionType: null,
  source: "manual" as const,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── liabilities ───────────────────────────────────────────────────────────────

export const liabilityRow = {
  id: FIXTURE_LIABILITY_ID,
  clientId: FIXTURE_CLIENT_ID,
  scenarioId: FIXTURE_SCENARIO_ID,
  name: "Mortgage",
  balance: "400000.00",
  balanceAsOfMonth: 1,
  balanceAsOfYear: 2026,
  interestRate: "0.0650",
  monthlyPayment: "2530.00",
  startYear: 2020,
  startMonth: 1,
  startYearRef: null,
  termMonths: 360,
  termUnit: "annual",
  linkedPropertyId: null,
  ownerEntityId: null,
  isInterestDeductible: true,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── savings_rules ─────────────────────────────────────────────────────────────

export const savingsRuleRow = {
  id: FIXTURE_SAVINGS_RULE_ID,
  clientId: FIXTURE_CLIENT_ID,
  scenarioId: FIXTURE_SCENARIO_ID,
  accountId: FIXTURE_ACCOUNT_ID_1,
  annualAmount: "23000.00",
  growthRate: "0.0000",
  growthSource: "custom" as const,
  startYear: 2026,
  endYear: 2033,
  startYearRef: null,
  endYearRef: null,
  employerMatchPct: null,
  employerMatchCap: null,
  employerMatchAmount: null,
  annualPercent: null,
  isDeductible: true,
  applyContributionLimit: true,
  contributeMax: false,
  annualLimit: null,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── family_members ────────────────────────────────────────────────────────────

export const familyMemberRow = {
  id: FIXTURE_FAMILY_MEMBER_ID,
  clientId: FIXTURE_CLIENT_ID,
  firstName: "Charlie",
  lastName: "Sample",
  relationship: "child" as const,
  dateOfBirth: "2002-08-10",
  notes: null,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── external_beneficiaries ────────────────────────────────────────────────────

export const externalBeneficiaryRow = {
  id: FIXTURE_EXTERNAL_BENE_ID,
  clientId: FIXTURE_CLIENT_ID,
  name: "Community Foundation",
  kind: "charity" as const,
  charityType: "public" as const,
  notes: null,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── wills + bequests + bequest_recipients ─────────────────────────────────────

export const willRow = {
  id: FIXTURE_WILL_ID,
  clientId: FIXTURE_CLIENT_ID,
  grantor: "client" as const,
  createdAt: NOW,
  updatedAt: NOW,
};

export const willBequestRow = {
  id: FIXTURE_BEQUEST_ID,
  willId: FIXTURE_WILL_ID,
  name: "Primary Residence to Charlie",
  kind: "asset" as const,
  assetMode: "specific" as const,
  accountId: FIXTURE_ACCOUNT_ID_1,
  liabilityId: null,
  percentage: "100.00",
  condition: "always" as const,
  sortOrder: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

export const willBequestRecipientRow = {
  id: FIXTURE_BEQUEST_RECIPIENT_ID,
  bequestId: FIXTURE_BEQUEST_ID,
  recipientKind: "family_member" as const,
  recipientId: FIXTURE_FAMILY_MEMBER_ID,
  percentage: "100.00",
  sortOrder: 0,
  createdAt: NOW,
  updatedAt: NOW,
};

// ── transfers ─────────────────────────────────────────────────────────────────

export const transferRow = {
  id: FIXTURE_TRANSFER_ID,
  clientId: FIXTURE_CLIENT_ID,
  scenarioId: FIXTURE_SCENARIO_ID,
  name: "Annual Brokerage Sweep",
  sourceAccountId: FIXTURE_ACCOUNT_ID_2,
  targetAccountId: FIXTURE_ACCOUNT_ID_1,
  amount: "10000.00",
  mode: "recurring" as const,
  startYear: 2027,
  startYearRef: null,
  endYear: 2033,
  endYearRef: null,
  growthRate: "0.0000",
  createdAt: NOW,
  updatedAt: NOW,
};

// ── tax_year_parameters ───────────────────────────────────────────────────────

export const taxYearParameterRow = {
  id: FIXTURE_TAX_YEAR_ID,
  year: 2026,
  incomeBrackets: [
    { rate: 0.1, upTo: 23200 },
    { rate: 0.12, upTo: 94300 },
    { rate: 0.22, upTo: 201050 },
    { rate: 0.24, upTo: 383900 },
    { rate: 0.32, upTo: 487450 },
    { rate: 0.35, upTo: 731200 },
    { rate: 0.37, upTo: null },
  ],
  capGainsBrackets: [
    { rate: 0, upTo: 94050 },
    { rate: 0.15, upTo: 583750 },
    { rate: 0.2, upTo: null },
  ],
  stdDeductionMfj: "29200.00",
  stdDeductionSingle: "14600.00",
  stdDeductionHoh: "21900.00",
  stdDeductionMfs: "14600.00",
  amtExemptionMfj: "137000.00",
  amtExemptionSingleHoh: "88100.00",
  amtExemptionMfs: "68500.00",
  amtBreakpoint2628MfjShoh: "220700.00",
  amtBreakpoint2628Mfs: "110350.00",
  amtPhaseoutStartMfj: "1310000.00",
  amtPhaseoutStartSingleHoh: "655000.00",
  amtPhaseoutStartMfs: "655000.00",
  ssTaxRate: "0.0620",
  ssWageBase: "168600.00",
  medicareTaxRate: "0.0145",
  addlMedicareRate: "0.0090",
  addlMedicareThresholdMfj: "250000.00",
  addlMedicareThresholdSingle: "200000.00",
  addlMedicareThresholdMfs: "125000.00",
  niitRate: "0.0380",
  niitThresholdMfj: "250000.00",
  niitThresholdSingle: "200000.00",
  niitThresholdMfs: "125000.00",
  qbiThresholdMfj: "383900.00",
  qbiThresholdSingleHohMfs: "191950.00",
  qbiPhaseInRangeMfj: "100000.00",
  qbiPhaseInRangeOther: "50000.00",
  ira401kElective: "23000.00",
  ira401kCatchup50: "7500.00",
  ira401kCatchup6063: "11250.00",
  iraTradLimit: "7000.00",
  iraCatchup50: "1000.00",
  simpleLimitRegular: "16000.00",
  simpleCatchup50: "3500.00",
  hsaLimitSelf: "4150.00",
  hsaLimitFamily: "8300.00",
  hsaCatchup55: "1000.00",
  giftAnnualExclusion: "18000.00",
  createdAt: NOW,
};

// ── Monte Carlo additional fixtures ──────────────────────────────────────────
// These rows are only used by load-monte-carlo-data.test.ts and are never
// seeded by load-client-data.test.ts, so they cannot disturb that snapshot.

/** A retirement account whose growth is driven by the model portfolio. */
export const mcAccountRow = {
  id: FIXTURE_ACCOUNT_ID_3,
  clientId: FIXTURE_CLIENT_ID,
  scenarioId: FIXTURE_SCENARIO_ID,
  name: "IRA (Model Portfolio)",
  category: "retirement" as const,
  subType: "ira_traditional" as const,
  owner: "client" as const,
  value: "100000.00",
  basis: "0.00",
  growthRate: "0.0700",
  rmdEnabled: true,
  isDefaultChecking: false,
  ownerEntityId: null,
  ownerFamilyMemberId: null,
  growthSource: "model_portfolio" as const,
  modelPortfolioId: FIXTURE_PORTFOLIO_ID,
  turnoverPct: "0.0000",
  overridePctOi: null,
  overridePctLtCg: null,
  overridePctQdiv: null,
  overridePctTaxExempt: null,
  annualPropertyTax: "0.00",
  propertyTaxGrowthRate: "0.0300",
  source: "manual" as const,
  createdAt: NOW,
  updatedAt: NOW,
};

/** An account-level asset allocation tying FIXTURE_ACCOUNT_ID_3 to US Equity. */
export const accountAssetAllocationRow = {
  id: FIXTURE_ACCOUNT_ASSET_ALLOC_ID,
  accountId: FIXTURE_ACCOUNT_ID_3,
  assetClassId: FIXTURE_ASSET_CLASS_ID,
  weight: "1.0000",
};

/**
 * A pairwise correlation row (canonical form: idA ≤ idB).
 * Uses FIXTURE_ASSET_CLASS_ID as both A and B so the self-correlation row
 * exercises the code path without needing a second asset class. The matrix
 * builder handles self-references via the diagonal-fill logic anyway, but
 * having at least one DB row ensures the JOIN + WHERE branch is exercised.
 *
 * The mock returns this row under the innerJoin shape:
 *   { asset_class_correlations: { assetClassIdA, assetClassIdB, correlation }, asset_classes: {...} }
 */
export const assetClassCorrelationRow = {
  asset_class_correlations: {
    id: FIXTURE_CORRELATION_ID,
    assetClassIdA: FIXTURE_ASSET_CLASS_ID,
    assetClassIdB: FIXTURE_ASSET_CLASS_ID,
    correlation: "1.00000",
    createdAt: NOW,
    updatedAt: NOW,
  },
  asset_classes: assetClassRow,
};
