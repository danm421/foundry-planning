import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  decimal,
  boolean,
  timestamp,
  pgEnum,
  unique,
  uniqueIndex,
  varchar,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ── Enums ────────────────────────────────────────────────────────────────────

export const filingStatusEnum = pgEnum("filing_status", [
  "single",
  "married_joint",
  "married_separate",
  "head_of_household",
]);

export const accountCategoryEnum = pgEnum("account_category", [
  "taxable",
  "cash",
  "retirement",
  "real_estate",
  "business",
  "life_insurance",
]);

export const accountSubTypeEnum = pgEnum("account_sub_type", [
  "brokerage",
  "savings",
  "checking",
  "traditional_ira",
  "roth_ira",
  "401k",
  "roth_401k",
  "403b",
  "roth_403b",
  "529",
  "trust",
  "other",
  // real_estate sub types
  "primary_residence",
  "rental_property",
  "commercial_property",
  // business sub types
  "sole_proprietorship",
  "partnership",
  "s_corp",
  "c_corp",
  "llc",
  // life_insurance sub types
  "term",
  "whole_life",
  "universal_life",
  "variable_life",
]);

export const ownerEnum = pgEnum("owner", ["client", "spouse", "joint"]);

export const incomeTypeEnum = pgEnum("income_type", [
  "salary",
  "social_security",
  "business",
  "deferred",
  "capital_gains",
  "trust",
  "other",
]);

export const expenseTypeEnum = pgEnum("expense_type", [
  "living",
  "other",
  "insurance",
]);

export const sourceEnum = pgEnum("source", ["manual", "extracted"]);

export const entityTypeEnum = pgEnum("entity_type", [
  "trust",
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "foundation",
  "other",
]);

export const familyRelationshipEnum = pgEnum("family_relationship", [
  "child",
  "grandchild",
  "parent",
  "sibling",
  "other",
]);

export const yearRefEnum = pgEnum("year_ref", [
  "plan_start",
  "plan_end",
  "client_retirement",
  "spouse_retirement",
  "client_end",
  "spouse_end",
  "client_ss_62",
  "client_ss_fra",
  "client_ss_70",
  "spouse_ss_62",
  "spouse_ss_fra",
  "spouse_ss_70",
]);

export const growthSourceEnum = pgEnum("growth_source", [
  "default",
  "model_portfolio",
  "custom",
  "asset_mix",
  "inflation",
]);

export const incomeTaxTypeEnum = pgEnum("income_tax_type", [
  "earned_income",
  "ordinary_income",
  "dividends",
  "capital_gains",
  "qbi",
  "tax_exempt",
  "stcg",
]);

export const taxEngineModeEnum = pgEnum("tax_engine_mode", [
  "flat",
  "bracket",
]);

export const deductionTypeEnum = pgEnum("deduction_type", [
  "charitable",
  "above_line",
  "below_line",
  "property_tax",
]);

export const extraPaymentTypeEnum = pgEnum("extra_payment_type", [
  "per_payment",
  "lump_sum",
]);

export const inflationRateSourceEnum = pgEnum("inflation_rate_source", [
  "asset_class",
  "custom",
]);

export const itemGrowthSourceEnum = pgEnum("item_growth_source", [
  "custom",
  "inflation",
]);

// ── Tables ───────────────────────────────────────────────────────────────────

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  advisorId: text("advisor_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dateOfBirth: date("date_of_birth").notNull(),
  retirementAge: integer("retirement_age").notNull(),
  planEndAge: integer("plan_end_age").notNull(),
  // Life expectancies are the source of truth for the plan horizon; plan_end_age
  // is derived (= max(death year across client + spouse) - clientBirthYear).
  lifeExpectancy: integer("life_expectancy").notNull().default(95),
  spouseName: text("spouse_name"),
  spouseLastName: text("spouse_last_name"),
  spouseDob: date("spouse_dob"),
  spouseRetirementAge: integer("spouse_retirement_age"),
  spouseLifeExpectancy: integer("spouse_life_expectancy"),
  filingStatus: filingStatusEnum("filing_status").notNull().default("single"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const scenarios = pgTable("scenarios", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  isBaseCase: boolean("is_base_case").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const planSettings = pgTable("plan_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  flatFederalRate: decimal("flat_federal_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.22"),
  flatStateRate: decimal("flat_state_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.05"),
  taxEngineMode: taxEngineModeEnum("tax_engine_mode").notNull().default("bracket"),
  taxInflationRate: decimal("tax_inflation_rate", { precision: 5, scale: 4 }),
  ssWageGrowthRate: decimal("ss_wage_growth_rate", { precision: 5, scale: 4 }),
  inflationRate: decimal("inflation_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
  planStartYear: integer("plan_start_year").notNull(),
  planEndYear: integer("plan_end_year").notNull(),
  // Default growth rates per account category (used when an account's growth_rate is null)
  defaultGrowthTaxable: decimal("default_growth_taxable", { precision: 5, scale: 4 })
    .notNull()
    .default("0.07"),
  defaultGrowthCash: decimal("default_growth_cash", { precision: 5, scale: 4 })
    .notNull()
    .default("0.02"),
  defaultGrowthRetirement: decimal("default_growth_retirement", { precision: 5, scale: 4 })
    .notNull()
    .default("0.07"),
  defaultGrowthRealEstate: decimal("default_growth_real_estate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.04"),
  defaultGrowthBusiness: decimal("default_growth_business", { precision: 5, scale: 4 })
    .notNull()
    .default("0.05"),
  defaultGrowthLifeInsurance: decimal("default_growth_life_insurance", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
  growthSourceTaxable: growthSourceEnum("growth_source_taxable").notNull().default("custom"),
  modelPortfolioIdTaxable: uuid("model_portfolio_id_taxable").references(() => modelPortfolios.id, { onDelete: "set null" }),
  growthSourceCash: growthSourceEnum("growth_source_cash").notNull().default("custom"),
  modelPortfolioIdCash: uuid("model_portfolio_id_cash").references(() => modelPortfolios.id, { onDelete: "set null" }),
  growthSourceRetirement: growthSourceEnum("growth_source_retirement").notNull().default("custom"),
  modelPortfolioIdRetirement: uuid("model_portfolio_id_retirement").references(() => modelPortfolios.id, { onDelete: "set null" }),
  selectedBenchmarkPortfolioId: uuid("selected_benchmark_portfolio_id").references(() => modelPortfolios.id, { onDelete: "set null" }),
  inflationRateSource: inflationRateSourceEnum("inflation_rate_source").notNull().default("asset_class"),
  useCustomCma: boolean("use_custom_cma").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const entities = pgTable("entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  entityType: entityTypeEnum("entity_type").notNull().default("trust"),
  // When true, the entity's accounts roll into the household portfolio-assets view.
  includeInPortfolio: boolean("include_in_portfolio").notNull().default(false),
  // When true, taxes on the entity's income / RMDs are paid at the household (grantor trust).
  isGrantor: boolean("is_grantor").notNull().default(false),
  // For business-interest entities (LLC/S-Corp/C-Corp/Partnership/Other): flat
  // valuation that surfaces on the balance sheet's Out of Estate section.
  // Null/zero for trust/foundation rows that hold value through child accounts.
  value: decimal("value", { precision: 15, scale: 2 }).notNull().default("0"),
  // Ownership for business entities (client/spouse/joint). Null for trusts.
  owner: ownerEnum("owner"),
  // Trust-only: list of grantors with percent ownership. Shape: { name, pct }[].
  grantors: jsonb("grantors"),
  // Trust-only: list of beneficiaries with percent distribution. Shape: { name, pct }[].
  beneficiaries: jsonb("beneficiaries"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const familyMembers = pgTable("family_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name"),
  relationship: familyRelationshipEnum("relationship").notNull().default("child"),
  dateOfBirth: date("date_of_birth"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const assetClasses = pgTable("asset_classes", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  name: text("name").notNull(),
  slug: varchar("slug", { length: 50 }),
  geometricReturn: decimal("geometric_return", { precision: 7, scale: 4 }).notNull().default("0.07"),
  arithmeticMean: decimal("arithmetic_mean", { precision: 7, scale: 4 }).notNull().default("0.085"),
  volatility: decimal("volatility", { precision: 7, scale: 4 }).notNull().default("0.15"),
  pctOrdinaryIncome: decimal("pct_ordinary_income", { precision: 5, scale: 4 }).notNull().default("0"),
  pctLtCapitalGains: decimal("pct_lt_capital_gains", { precision: 5, scale: 4 }).notNull().default("0.85"),
  pctQualifiedDividends: decimal("pct_qualified_dividends", { precision: 5, scale: 4 }).notNull().default("0.15"),
  pctTaxExempt: decimal("pct_tax_exempt", { precision: 5, scale: 4 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique("asset_classes_firm_id_name_unique").on(t.firmId, t.name)]);

export const modelPortfolios = pgTable("model_portfolios", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique("model_portfolios_firm_id_name_unique").on(t.firmId, t.name)]);

export const modelPortfolioAllocations = pgTable("model_portfolio_allocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  modelPortfolioId: uuid("model_portfolio_id")
    .notNull()
    .references(() => modelPortfolios.id, { onDelete: "cascade" }),
  assetClassId: uuid("asset_class_id")
    .notNull()
    .references(() => assetClasses.id, { onDelete: "cascade" }),
  weight: decimal("weight", { precision: 5, scale: 4 }).notNull(),
});

export const accountAssetAllocations = pgTable(
  "account_asset_allocations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    assetClassId: uuid("asset_class_id")
      .notNull()
      .references(() => assetClasses.id, { onDelete: "cascade" }),
    weight: decimal("weight", { precision: 5, scale: 4 })
      .notNull()
      .default("0"),
  },
  (t) => [uniqueIndex("account_asset_alloc_uniq").on(t.accountId, t.assetClassId)]
);

export const clientCmaOverrides = pgTable("client_cma_overrides", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  sourceAssetClassId: uuid("source_asset_class_id")
    .references(() => assetClasses.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  geometricReturn: decimal("geometric_return", { precision: 7, scale: 4 }).notNull(),
  arithmeticMean: decimal("arithmetic_mean", { precision: 7, scale: 4 }).notNull(),
  volatility: decimal("volatility", { precision: 7, scale: 4 }).notNull(),
  pctOrdinaryIncome: decimal("pct_ordinary_income", { precision: 5, scale: 4 }).notNull(),
  pctLtCapitalGains: decimal("pct_lt_capital_gains", { precision: 5, scale: 4 }).notNull(),
  pctQualifiedDividends: decimal("pct_qualified_dividends", { precision: 5, scale: 4 }).notNull(),
  pctTaxExempt: decimal("pct_tax_exempt", { precision: 5, scale: 4 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: accountCategoryEnum("category").notNull(),
  subType: accountSubTypeEnum("sub_type").notNull().default("other"),
  owner: ownerEnum("owner").notNull().default("client"),
  value: decimal("value", { precision: 15, scale: 2 }).notNull().default("0"),
  basis: decimal("basis", { precision: 15, scale: 2 }).notNull().default("0"),
  // Null means: inherit the default for this category from plan_settings.
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 }),
  rmdEnabled: boolean("rmd_enabled").notNull().default(false),
  // Exactly one account per (client, scenario) has this flag set. Household income is
  // paid into this account and expenses, taxes, and savings are drawn from it; when it
  // goes negative the engine pulls from the withdrawal strategy to top it up.
  isDefaultChecking: boolean("is_default_checking").notNull().default(false),
  // When set, the account is considered owned by a non-individual entity (trust, LLC, etc.)
  // and is treated as "out of estate" relative to client/spouse/joint ownership.
  ownerEntityId: uuid("owner_entity_id").references(() => entities.id, {
    onDelete: "set null",
  }),
  growthSource: growthSourceEnum("growth_source").notNull().default("default"),
  modelPortfolioId: uuid("model_portfolio_id").references(() => modelPortfolios.id, {
    onDelete: "set null",
  }),
  turnoverPct: decimal("turnover_pct", { precision: 5, scale: 4 }).notNull().default("0"),
  overridePctOi: decimal("override_pct_oi", { precision: 5, scale: 4 }),
  overridePctLtCg: decimal("override_pct_lt_cg", { precision: 5, scale: 4 }),
  overridePctQdiv: decimal("override_pct_qdiv", { precision: 5, scale: 4 }),
  overridePctTaxExempt: decimal("override_pct_tax_exempt", { precision: 5, scale: 4 }),
  annualPropertyTax: decimal("annual_property_tax", { precision: 15, scale: 2 }).notNull().default("0"),
  propertyTaxGrowthRate: decimal("property_tax_growth_rate", { precision: 5, scale: 4 }).notNull().default("0.03"),
  source: sourceEnum("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const incomes = pgTable("incomes", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  type: incomeTypeEnum("type").notNull(),
  name: text("name").notNull(),
  annualAmount: decimal("annual_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  startYear: integer("start_year").notNull(),
  endYear: integer("end_year").notNull(),
  startYearRef: yearRefEnum("start_year_ref"),
  endYearRef: yearRefEnum("end_year_ref"),
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
  growthSource: itemGrowthSourceEnum("growth_source").notNull().default("custom"),
  // When set, inflation compounds from this year instead of from start_year.
  // Null = inflate from entry start (current-dollar amount).
  inflationStartYear: integer("inflation_start_year"),
  owner: ownerEnum("owner").notNull().default("client"),
  claimingAge: integer("claiming_age"),
  linkedEntityId: uuid("linked_entity_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  ownerEntityId: uuid("owner_entity_id").references(() => entities.id, {
    onDelete: "set null",
  }),
  // Cash account this income deposits into. Null falls back to the appropriate default
  // checking account (household, or entity checking if ownerEntityId is set).
  cashAccountId: uuid("cash_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  taxType: incomeTaxTypeEnum("tax_type"),
  source: sourceEnum("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const expenses = pgTable("expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  type: expenseTypeEnum("type").notNull(),
  name: text("name").notNull(),
  annualAmount: decimal("annual_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  startYear: integer("start_year").notNull(),
  endYear: integer("end_year").notNull(),
  startYearRef: yearRefEnum("start_year_ref"),
  endYearRef: yearRefEnum("end_year_ref"),
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
  growthSource: itemGrowthSourceEnum("growth_source").notNull().default("custom"),
  // When set, inflation compounds from this year instead of from start_year.
  // Null = inflate from entry start (current-dollar amount).
  inflationStartYear: integer("inflation_start_year"),
  ownerEntityId: uuid("owner_entity_id").references(() => entities.id, {
    onDelete: "set null",
  }),
  // Cash account this expense is paid from.
  cashAccountId: uuid("cash_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  deductionType: deductionTypeEnum("deduction_type"),
  source: sourceEnum("source").notNull().default("manual"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const liabilities = pgTable("liabilities", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  balance: decimal("balance", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  balanceAsOfMonth: integer("balance_as_of_month"),
  balanceAsOfYear: integer("balance_as_of_year"),
  interestRate: decimal("interest_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0"),
  monthlyPayment: decimal("monthly_payment", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  startYear: integer("start_year").notNull(),
  startMonth: integer("start_month").notNull().default(1),
  startYearRef: yearRefEnum("start_year_ref"),
  termMonths: integer("term_months").notNull(),
  termUnit: text("term_unit").notNull().default("annual"),
  linkedPropertyId: uuid("linked_property_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  ownerEntityId: uuid("owner_entity_id").references(() => entities.id, {
    onDelete: "set null",
  }),
  isInterestDeductible: boolean("is_interest_deductible").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const extraPayments = pgTable("extra_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  liabilityId: uuid("liability_id")
    .notNull()
    .references(() => liabilities.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  type: extraPaymentTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const savingsRules = pgTable("savings_rules", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  annualAmount: decimal("annual_amount", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0"),
  growthSource: itemGrowthSourceEnum("growth_source").notNull().default("custom"),
  startYear: integer("start_year").notNull(),
  endYear: integer("end_year").notNull(),
  startYearRef: yearRefEnum("start_year_ref"),
  endYearRef: yearRefEnum("end_year_ref"),
  employerMatchPct: decimal("employer_match_pct", { precision: 5, scale: 4 }),
  employerMatchCap: decimal("employer_match_cap", { precision: 5, scale: 4 }),
  // Flat annual dollar amount alternative to the pct/cap style. When set, the
  // engine uses this and ignores employerMatchPct/Cap.
  employerMatchAmount: decimal("employer_match_amount", { precision: 15, scale: 2 }),
  // When non-null, the engine resolves this rule's contribution as
  // ownerSalary * annualPercent per year. When null, annualAmount is used.
  annualPercent: decimal("annual_percent", { precision: 6, scale: 4 }),
  // Whether this contribution counts as an above-the-line deduction.
  // Engine gates deduction on subtype eligibility AND this flag.
  isDeductible: boolean("is_deductible").notNull().default(true),
  // When true (default), the engine caps the contribution at the applicable
  // IRS limit (401k/403b deferral or IRA base+catch-up). When false, the
  // rule bypasses the cap — advisor models the contribution verbatim.
  applyContributionLimit: boolean("apply_contribution_limit").notNull().default(true),
  annualLimit: decimal("annual_limit", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const withdrawalStrategies = pgTable("withdrawal_strategies", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  priorityOrder: integer("priority_order").notNull(),
  startYear: integer("start_year").notNull(),
  endYear: integer("end_year").notNull(),
  startYearRef: yearRefEnum("start_year_ref"),
  endYearRef: yearRefEnum("end_year_ref"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Relations ────────────────────────────────────────────────────────────────

export const clientsRelations = relations(clients, ({ many }) => ({
  scenarios: many(scenarios),
  accounts: many(accounts),
  incomes: many(incomes),
  expenses: many(expenses),
  liabilities: many(liabilities),
  savingsRules: many(savingsRules),
  withdrawalStrategies: many(withdrawalStrategies),
  planSettings: many(planSettings),
  entities: many(entities),
  familyMembers: many(familyMembers),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  client: one(clients, {
    fields: [entities.clientId],
    references: [clients.id],
  }),
  accounts: many(accounts),
}));

export const familyMembersRelations = relations(familyMembers, ({ one }) => ({
  client: one(clients, {
    fields: [familyMembers.clientId],
    references: [clients.id],
  }),
}));

export const scenariosRelations = relations(scenarios, ({ one, many }) => ({
  client: one(clients, {
    fields: [scenarios.clientId],
    references: [clients.id],
  }),
  accounts: many(accounts),
  incomes: many(incomes),
  expenses: many(expenses),
  liabilities: many(liabilities),
  savingsRules: many(savingsRules),
  withdrawalStrategies: many(withdrawalStrategies),
  planSettings: many(planSettings),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  client: one(clients, {
    fields: [accounts.clientId],
    references: [clients.id],
  }),
  scenario: one(scenarios, {
    fields: [accounts.scenarioId],
    references: [scenarios.id],
  }),
  savingsRules: many(savingsRules),
  withdrawalStrategies: many(withdrawalStrategies),
}));

export const incomesRelations = relations(incomes, ({ one }) => ({
  client: one(clients, {
    fields: [incomes.clientId],
    references: [clients.id],
  }),
  scenario: one(scenarios, {
    fields: [incomes.scenarioId],
    references: [scenarios.id],
  }),
  linkedEntity: one(accounts, {
    fields: [incomes.linkedEntityId],
    references: [accounts.id],
  }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  client: one(clients, {
    fields: [expenses.clientId],
    references: [clients.id],
  }),
  scenario: one(scenarios, {
    fields: [expenses.scenarioId],
    references: [scenarios.id],
  }),
}));

export const liabilitiesRelations = relations(liabilities, ({ one, many }) => ({
  client: one(clients, {
    fields: [liabilities.clientId],
    references: [clients.id],
  }),
  scenario: one(scenarios, {
    fields: [liabilities.scenarioId],
    references: [scenarios.id],
  }),
  linkedProperty: one(accounts, {
    fields: [liabilities.linkedPropertyId],
    references: [accounts.id],
  }),
  extraPayments: many(extraPayments),
}));

export const extraPaymentsRelations = relations(extraPayments, ({ one }) => ({
  liability: one(liabilities, {
    fields: [extraPayments.liabilityId],
    references: [liabilities.id],
  }),
}));

export const savingsRulesRelations = relations(savingsRules, ({ one }) => ({
  client: one(clients, {
    fields: [savingsRules.clientId],
    references: [clients.id],
  }),
  scenario: one(scenarios, {
    fields: [savingsRules.scenarioId],
    references: [scenarios.id],
  }),
  account: one(accounts, {
    fields: [savingsRules.accountId],
    references: [accounts.id],
  }),
}));

export const withdrawalStrategiesRelations = relations(
  withdrawalStrategies,
  ({ one }) => ({
    client: one(clients, {
      fields: [withdrawalStrategies.clientId],
      references: [clients.id],
    }),
    scenario: one(scenarios, {
      fields: [withdrawalStrategies.scenarioId],
      references: [scenarios.id],
    }),
    account: one(accounts, {
      fields: [withdrawalStrategies.accountId],
      references: [accounts.id],
    }),
  })
);

export const planSettingsRelations = relations(planSettings, ({ one }) => ({
  client: one(clients, {
    fields: [planSettings.clientId],
    references: [clients.id],
  }),
  scenario: one(scenarios, {
    fields: [planSettings.scenarioId],
    references: [scenarios.id],
  }),
}));

// ── Client Deductions ─────────────────────────────────────────────────────────

export const clientDeductions = pgTable("client_deductions", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),

  type: deductionTypeEnum("type").notNull(),
  name: text("name"),
  owner: ownerEnum("owner").notNull().default("joint"),
  annualAmount: decimal("annual_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 }).notNull().default("0"),

  startYear: integer("start_year").notNull(),
  endYear: integer("end_year").notNull(),
  startYearRef: yearRefEnum("start_year_ref"),
  endYearRef: yearRefEnum("end_year_ref"),

  source: sourceEnum("source").notNull().default("manual"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Tax Reference Data ────────────────────────────────────────────────────────

export const taxYearParameters = pgTable("tax_year_parameters", {
  id: uuid("id").primaryKey().defaultRandom(),
  year: integer("year").notNull().unique(),

  incomeBrackets: jsonb("income_brackets").notNull(),
  capGainsBrackets: jsonb("cap_gains_brackets").notNull(),

  stdDeductionMfj: decimal("std_deduction_mfj", { precision: 10, scale: 2 }).notNull(),
  stdDeductionSingle: decimal("std_deduction_single", { precision: 10, scale: 2 }).notNull(),
  stdDeductionHoh: decimal("std_deduction_hoh", { precision: 10, scale: 2 }).notNull(),
  stdDeductionMfs: decimal("std_deduction_mfs", { precision: 10, scale: 2 }).notNull(),

  amtExemptionMfj: decimal("amt_exemption_mfj", { precision: 12, scale: 2 }).notNull(),
  amtExemptionSingleHoh: decimal("amt_exemption_single_hoh", { precision: 12, scale: 2 }).notNull(),
  amtExemptionMfs: decimal("amt_exemption_mfs", { precision: 12, scale: 2 }).notNull(),
  amtBreakpoint2628MfjShoh: decimal("amt_breakpoint_2628_mfj_shoh", { precision: 12, scale: 2 }).notNull(),
  amtBreakpoint2628Mfs: decimal("amt_breakpoint_2628_mfs", { precision: 12, scale: 2 }).notNull(),
  amtPhaseoutStartMfj: decimal("amt_phaseout_start_mfj", { precision: 12, scale: 2 }).notNull(),
  amtPhaseoutStartSingleHoh: decimal("amt_phaseout_start_single_hoh", { precision: 12, scale: 2 }).notNull(),
  amtPhaseoutStartMfs: decimal("amt_phaseout_start_mfs", { precision: 12, scale: 2 }).notNull(),

  ssTaxRate: decimal("ss_tax_rate", { precision: 5, scale: 4 }).notNull(),
  ssWageBase: decimal("ss_wage_base", { precision: 12, scale: 2 }).notNull(),
  medicareTaxRate: decimal("medicare_tax_rate", { precision: 5, scale: 4 }).notNull(),
  addlMedicareRate: decimal("addl_medicare_rate", { precision: 5, scale: 4 }).notNull(),
  addlMedicareThresholdMfj: decimal("addl_medicare_threshold_mfj", { precision: 12, scale: 2 }).notNull(),
  addlMedicareThresholdSingle: decimal("addl_medicare_threshold_single", { precision: 12, scale: 2 }).notNull(),
  addlMedicareThresholdMfs: decimal("addl_medicare_threshold_mfs", { precision: 12, scale: 2 }).notNull(),

  niitRate: decimal("niit_rate", { precision: 5, scale: 4 }).notNull(),
  niitThresholdMfj: decimal("niit_threshold_mfj", { precision: 12, scale: 2 }).notNull(),
  niitThresholdSingle: decimal("niit_threshold_single", { precision: 12, scale: 2 }).notNull(),
  niitThresholdMfs: decimal("niit_threshold_mfs", { precision: 12, scale: 2 }).notNull(),

  qbiThresholdMfj: decimal("qbi_threshold_mfj", { precision: 12, scale: 2 }).notNull(),
  qbiThresholdSingleHohMfs: decimal("qbi_threshold_single_hoh_mfs", { precision: 12, scale: 2 }).notNull(),
  qbiPhaseInRangeMfj: decimal("qbi_phase_in_range_mfj", { precision: 12, scale: 2 }).notNull(),
  qbiPhaseInRangeOther: decimal("qbi_phase_in_range_other", { precision: 12, scale: 2 }).notNull(),

  ira401kElective: decimal("ira_401k_elective", { precision: 10, scale: 2 }).notNull(),
  ira401kCatchup50: decimal("ira_401k_catchup_50", { precision: 10, scale: 2 }).notNull(),
  ira401kCatchup6063: decimal("ira_401k_catchup_60_63", { precision: 10, scale: 2 }),
  iraTradLimit: decimal("ira_trad_limit", { precision: 10, scale: 2 }).notNull(),
  iraCatchup50: decimal("ira_catchup_50", { precision: 10, scale: 2 }).notNull(),
  simpleLimitRegular: decimal("simple_limit_regular", { precision: 10, scale: 2 }).notNull(),
  simpleCatchup50: decimal("simple_catchup_50", { precision: 10, scale: 2 }).notNull(),
  hsaLimitSelf: decimal("hsa_limit_self", { precision: 10, scale: 2 }).notNull(),
  hsaLimitFamily: decimal("hsa_limit_family", { precision: 10, scale: 2 }).notNull(),
  hsaCatchup55: decimal("hsa_catchup_55", { precision: 10, scale: 2 }).notNull(),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Schedule Overrides ──────────────────────────────────────────────────────
// Year-by-year amount overrides for incomes, expenses, and savings rules.
// When a row has any overrides, the engine uses them instead of growth-rate math.

export const incomeScheduleOverrides = pgTable(
  "income_schedule_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    incomeId: uuid("income_id")
      .notNull()
      .references(() => incomes.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  },
  (t) => [unique("income_schedule_year_uniq").on(t.incomeId, t.year)]
);

export const expenseScheduleOverrides = pgTable(
  "expense_schedule_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  },
  (t) => [unique("expense_schedule_year_uniq").on(t.expenseId, t.year)]
);

export const savingsScheduleOverrides = pgTable(
  "savings_schedule_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    savingsRuleId: uuid("savings_rule_id")
      .notNull()
      .references(() => savingsRules.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  },
  (t) => [unique("savings_schedule_year_uniq").on(t.savingsRuleId, t.year)]
);

// ============================================================================
// Transfers
// ============================================================================

export const transferModeEnum = pgEnum("transfer_mode", ["one_time", "recurring", "scheduled"]);

export const transfers = pgTable("transfers", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sourceAccountId: uuid("source_account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  targetAccountId: uuid("target_account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull().default("0"),
  mode: transferModeEnum("mode").notNull().default("one_time"),
  startYear: integer("start_year").notNull(),
  startYearRef: yearRefEnum("start_year_ref"),
  endYear: integer("end_year"),
  endYearRef: yearRefEnum("end_year_ref"),
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const transferSchedules = pgTable("transfer_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  transferId: uuid("transfer_id").notNull().references(() => transfers.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ============================================================================
// Asset Transactions
// ============================================================================

export const assetTransactionTypeEnum = pgEnum("asset_transaction_type", ["buy", "sell"]);

export const assetTransactions = pgTable("asset_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: assetTransactionTypeEnum("type").notNull(),
  year: integer("year").notNull(),
  // Sale fields
  accountId: uuid("account_id").references(() => accounts.id, { onDelete: "cascade" }),
  overrideSaleValue: decimal("override_sale_value", { precision: 15, scale: 2 }),
  overrideBasis: decimal("override_basis", { precision: 15, scale: 2 }),
  transactionCostPct: decimal("transaction_cost_pct", { precision: 5, scale: 4 }),
  transactionCostFlat: decimal("transaction_cost_flat", { precision: 15, scale: 2 }),
  proceedsAccountId: uuid("proceeds_account_id").references(() => accounts.id, { onDelete: "set null" }),
  // IRC §121 primary-residence exclusion. When true AND the sold account's
  // category is "real_estate", the engine subtracts up to $250k (most filing
  // statuses) or $500k (married filing jointly) from the raw capital gain.
  qualifiesForHomeSaleExclusion: boolean("qualifies_for_home_sale_exclusion")
    .notNull()
    .default(false),
  // Buy fields
  assetName: text("asset_name"),
  assetCategory: accountCategoryEnum("asset_category"),
  assetSubType: accountSubTypeEnum("asset_sub_type"),
  purchasePrice: decimal("purchase_price", { precision: 15, scale: 2 }),
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 }),
  growthSource: growthSourceEnum("asset_growth_source"),
  modelPortfolioId: uuid("asset_model_portfolio_id").references(() => modelPortfolios.id, { onDelete: "set null" }),
  basis: decimal("basis", { precision: 15, scale: 2 }),
  fundingAccountId: uuid("funding_account_id").references(() => accounts.id, { onDelete: "set null" }),
  mortgageAmount: decimal("mortgage_amount", { precision: 15, scale: 2 }),
  mortgageRate: decimal("mortgage_rate", { precision: 5, scale: 4 }),
  mortgageTermMonths: integer("mortgage_term_months"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const reportComments = pgTable(
  "report_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "cascade" }),
    reportKey: text("report_key").notNull(),
    body: text("body").notNull().default(""),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("report_comments_client_scenario_key_unique").on(t.clientId, t.scenarioId, t.reportKey)],
);
