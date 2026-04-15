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
  spouseName: text("spouse_name"),
  spouseLastName: text("spouse_last_name"),
  spouseDob: date("spouse_dob"),
  spouseRetirementAge: integer("spouse_retirement_age"),
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
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
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
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
  ownerEntityId: uuid("owner_entity_id").references(() => entities.id, {
    onDelete: "set null",
  }),
  // Cash account this expense is paid from.
  cashAccountId: uuid("cash_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
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
  interestRate: decimal("interest_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0"),
  monthlyPayment: decimal("monthly_payment", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  startYear: integer("start_year").notNull(),
  endYear: integer("end_year").notNull(),
  linkedPropertyId: uuid("linked_property_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  ownerEntityId: uuid("owner_entity_id").references(() => entities.id, {
    onDelete: "set null",
  }),
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
  startYear: integer("start_year").notNull(),
  endYear: integer("end_year").notNull(),
  employerMatchPct: decimal("employer_match_pct", { precision: 5, scale: 4 }),
  employerMatchCap: decimal("employer_match_cap", { precision: 5, scale: 4 }),
  // Flat annual dollar amount alternative to the pct/cap style. When set, the
  // engine uses this and ignores employerMatchPct/Cap.
  employerMatchAmount: decimal("employer_match_amount", { precision: 15, scale: 2 }),
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

export const liabilitiesRelations = relations(liabilities, ({ one }) => ({
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
