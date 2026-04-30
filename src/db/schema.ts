import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  decimal,
  numeric,
  boolean,
  timestamp,
  pgEnum,
  unique,
  uniqueIndex,
  varchar,
  jsonb,
  index,
  check,
  foreignKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import type { BracketTier } from "@/lib/tax/types";

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

export const insuredPersonEnum = pgEnum("insured_person", [
  "client",
  "spouse",
  "joint",
]);

export const policyTypeEnum = pgEnum("policy_type", [
  "term",
  "whole",
  "universal",
  "variable",
]);

export const cashValueGrowthModeEnum = pgEnum("cash_value_growth_mode", [
  "basic",
  "free_form",
]);

export const entityGrantorEnum = pgEnum("entity_grantor_enum", ["client", "spouse"]);

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

export const sourceEnum = pgEnum("source", ["manual", "extracted", "policy"]);

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

export const externalBeneficiaryKindEnum = pgEnum("external_beneficiary_kind", [
  "charity",
  "individual",
]);

export const charityTypeEnum = pgEnum("charity_type", ["public", "private"]);

export const beneficiaryTierEnum = pgEnum("beneficiary_tier", [
  "primary",
  "contingent",
  "income",
  "remainder",
]);

export const beneficiaryTargetKindEnum = pgEnum("beneficiary_target_kind", [
  "account",
  "trust",
]);

export const householdRoleEnum = pgEnum("household_role", [
  "client",
  "spouse",
]);

export const familyMemberRoleEnum = pgEnum("family_member_role", [
  "client",
  "spouse",
  "child",
  "other",
]);

export const ownerKindEnum = pgEnum("owner_kind", ["family_member", "entity"]);

export const trustEndsEnum = pgEnum("trust_ends", [
  "client_death",
  "spouse_death",
  "survivorship",
]);

export const trustSubTypeEnum = pgEnum("trust_sub_type", [
  "revocable",
  "irrevocable",
  "ilit",
  "slat",
  "crt",
  "grat",
  "qprt",
  "clat",
  "qtip",
  "bypass",
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

export const scenarioOpTypeEnum = pgEnum("scenario_op_type", ["add", "edit", "remove"]);

export const scenarioSnapshotSourceKindEnum = pgEnum("scenario_snapshot_source_kind", [
  "manual",
  "pdf_export",
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

export const openItemPriorityEnum = pgEnum("open_item_priority", [
  "low",
  "medium",
  "high",
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
  email: text("email"),
  address: text("address"),
  spouseEmail: text("spouse_email"),
  spouseAddress: text("spouse_address"),
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
  // Monte Carlo PRNG seed. Persisted so repeat views of the MC report produce
  // identical numbers (per eMoney whitepaper p.13 "Result Repeatability").
  // Null = no seed saved yet; the UI generates one on first run and persists it.
  // Clicking "Restart" in the MC report overwrites this with a fresh seed.
  monteCarloSeed: integer("monte_carlo_seed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const scenarioToggleGroups = pgTable("scenario_toggle_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  defaultOn: boolean("default_on").notNull().default(true),
  // Self-reference for one-level dependency (parent off → this group forcibly off in engine).
  // v1 enforces single-level via UI; the schema doesn't structurally prevent chains.
  requiresGroupId: uuid("requires_group_id"),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const scenarioChanges = pgTable("scenario_changes", {
  id: uuid("id").defaultRandom().primaryKey(),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  opType: scenarioOpTypeEnum("op_type").notNull(),
  // target_kind is text (not pgEnum) because the value list grows whenever a
  // new overlayable entity lands. CHECK can be added later if value drift
  // becomes a problem; v1 relies on TypeScript types for correctness.
  targetKind: text("target_kind").notNull(),
  targetId: uuid("target_id").notNull(),
  // payload shape depends on op_type:
  //  add    -> full entity object
  //  edit   -> { fieldName: { from, to } }
  //  remove -> null (column allows null only for remove)
  payload: jsonb("payload"),
  toggleGroupId: uuid("toggle_group_id")
    .references(() => scenarioToggleGroups.id, { onDelete: "set null" }),
  orderIndex: integer("order_index").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Uniqueness: one row per (scenario, target entity, op-type). Editing the
  // same entity twice updates the existing row's payload; UI does upsert.
  uniqueChange: uniqueIndex("scenario_changes_unique").on(
    table.scenarioId, table.targetKind, table.targetId, table.opType,
  ),
}));

export const scenarioSnapshots = pgTable("scenario_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // Source scenarios are nullable so snapshots survive scenario deletion.
  // Intentionally NOT cascade-delete — see spec §3.1.
  leftScenarioId: uuid("left_scenario_id"),
  rightScenarioId: uuid("right_scenario_id"),
  effectiveTreeLeft: jsonb("effective_tree_left").notNull(),
  effectiveTreeRight: jsonb("effective_tree_right").notNull(),
  toggleState: jsonb("toggle_state").notNull(),
  rawChangesRight: jsonb("raw_changes_right").notNull(),
  rawToggleGroupsRight: jsonb("raw_toggle_groups_right").notNull(),
  frozenAt: timestamp("frozen_at").defaultNow().notNull(),
  // Clerk userIds are strings like `user_2qXyZ...`, not uuids. Stored as text
  // to mirror `audit_log.actor_id`. Originally declared `uuid` in 0050, fixed
  // in 0053 before the table was first written to in production.
  frozenByUserId: text("frozen_by_user_id").notNull(),
  sourceKind: scenarioSnapshotSourceKindEnum("source_kind").notNull().default("manual"),
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
  estateAdminExpenses: decimal("estate_admin_expenses", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  flatStateEstateRate: decimal("flat_state_estate_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0"),
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
  growthSourceTaxable: growthSourceEnum("growth_source_taxable").notNull().default("inflation"),
  modelPortfolioIdTaxable: uuid("model_portfolio_id_taxable").references(() => modelPortfolios.id, { onDelete: "set null" }),
  growthSourceCash: growthSourceEnum("growth_source_cash").notNull().default("inflation"),
  modelPortfolioIdCash: uuid("model_portfolio_id_cash").references(() => modelPortfolios.id, { onDelete: "set null" }),
  growthSourceRetirement: growthSourceEnum("growth_source_retirement").notNull().default("inflation"),
  modelPortfolioIdRetirement: uuid("model_portfolio_id_retirement").references(() => modelPortfolios.id, { onDelete: "set null" }),
  selectedBenchmarkPortfolioId: uuid("selected_benchmark_portfolio_id").references(() => modelPortfolios.id, { onDelete: "set null" }),
  inflationRateSource: inflationRateSourceEnum("inflation_rate_source").notNull().default("asset_class"),
  useCustomCma: boolean("use_custom_cma").notNull().default(false),
  // Effective tax rate applied to DNI distributed to out-of-household beneficiaries
  // (non-grantor trusts with external income beneficiaries). Defaults to top federal bracket.
  outOfHouseholdDniRate: decimal("out_of_household_dni_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.37"),
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
  // Trust-only: single grantor ('client' or 'spouse'). Null for third-party trusts.
  grantor: entityGrantorEnum("grantor"),
  // Trust-only: list of beneficiaries with percent distribution. Shape: { name, pct }[].
  // DEPRECATED: superseded by the beneficiary_designations table. Retained for read-back
  // compatibility; item 2 will migrate and drop.
  beneficiaries: jsonb("beneficiaries"),
  // Trust-only. Nullable on non-trust rows (LLC / S-Corp / etc.). API-level
  // rule: required when entity_type = 'trust', forbidden otherwise.
  trustSubType: trustSubTypeEnum("trust_sub_type"),
  // Trust-only. Must stay consistent with trust_sub_type (revocable → false;
  // all others → true). API-enforced via deriveIsIrrevocable.
  isIrrevocable: boolean("is_irrevocable"),
  // Free-text display-only field. Co-trustees as comma-separated.
  trustee: text("trustee"),
  // Trust-only: when does the trust terminate? Drives engine logic for
  // when remainder beneficiaries take over. Null on non-trust rows.
  trustEnds: trustEndsEnum("trust_ends"),
  // Trust-only: mandatory-distribution policy. One of 'fixed' | 'pct_liquid' | 'pct_income',
  // or null when no mandatory distribution. API enforces coherence with the amount/percent columns.
  distributionMode: text("distribution_mode").$type<"fixed" | "pct_liquid" | "pct_income" | null>(),
  distributionAmount: decimal("distribution_amount", { precision: 14, scale: 2 }),
  distributionPercent: decimal("distribution_percent", { precision: 7, scale: 4 }),
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
  role: familyMemberRoleEnum("role").notNull().default("other"),
  dateOfBirth: date("date_of_birth"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const externalBeneficiaries = pgTable("external_beneficiaries", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: externalBeneficiaryKindEnum("kind").notNull().default("charity"),
  charityType: charityTypeEnum("charity_type").notNull().default("public"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const beneficiaryDesignations = pgTable(
  "beneficiary_designations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    targetKind: beneficiaryTargetKindEnum("target_kind").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    tier: beneficiaryTierEnum("tier").notNull(),
    familyMemberId: uuid("family_member_id").references(() => familyMembers.id, {
      onDelete: "cascade",
    }),
    externalBeneficiaryId: uuid("external_beneficiary_id").references(
      () => externalBeneficiaries.id,
      { onDelete: "cascade" },
    ),
    // When a designation NAMES another entity (e.g. trust → trust) as a
    // beneficiary, this points at that entity. Distinct from `entity_id`
    // above, which identifies the trust the designation BELONGS TO.
    entityIdRef: uuid("entity_id_ref").references(() => entities.id, {
      onDelete: "set null",
    }),
    // When the named beneficiary is the household principal — 'client' or
    // 'spouse'. Mutually exclusive with the other named-beneficiary FKs.
    householdRole: householdRoleEnum("household_role"),
    percentage: decimal("percentage", { precision: 5, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("beneficiary_designations_account_idx").on(
      t.clientId,
      t.targetKind,
      t.accountId,
    ),
    index("beneficiary_designations_entity_idx").on(
      t.clientId,
      t.targetKind,
      t.entityId,
    ),
  ],
);

export const gifts = pgTable(
  "gifts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    yearRef: yearRefEnum("year_ref"),
    amount: decimal("amount", { precision: 15, scale: 2 }),
    grantor: ownerEnum("grantor").notNull(),
    recipientEntityId: uuid("recipient_entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    recipientFamilyMemberId: uuid("recipient_family_member_id").references(
      () => familyMembers.id,
      { onDelete: "cascade" },
    ),
    recipientExternalBeneficiaryId: uuid(
      "recipient_external_beneficiary_id",
    ).references(() => externalBeneficiaries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    liabilityId: uuid("liability_id").references(() => liabilities.id, {
      onDelete: "set null",
    }),
    percent: decimal("percent", { precision: 6, scale: 4 }),
    parentGiftId: uuid("parent_gift_id"),
    useCrummeyPowers: boolean("use_crummey_powers").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("gifts_client_year_idx").on(t.clientId, t.year),
    index("gifts_client_grantor_year_idx").on(t.clientId, t.grantor, t.year),
    index("gifts_recipient_year_idx").on(t.recipientEntityId, t.year),
    index("gifts_recipient_family_member_year_idx")
      .on(t.recipientFamilyMemberId, t.year)
      .where(sql`${t.recipientFamilyMemberId} IS NOT NULL`),
    index("gifts_recipient_external_beneficiary_year_idx")
      .on(t.recipientExternalBeneficiaryId, t.year)
      .where(sql`${t.recipientExternalBeneficiaryId} IS NOT NULL`),
    index("gifts_account_year_idx").on(t.accountId, t.year),
    index("gifts_liability_year_idx").on(t.liabilityId, t.year),
    foreignKey({
      columns: [t.parentGiftId],
      foreignColumns: [t.id],
      name: "gifts_parent_gift_id_fk",
    }).onDelete("cascade"),
    check(
      "gifts_event_kind",
      sql`(
        (${t.amount} IS NOT NULL AND ${t.accountId} IS NULL AND ${t.liabilityId} IS NULL AND ${t.percent} IS NULL)
        OR
        ((${t.accountId} IS NOT NULL OR ${t.liabilityId} IS NOT NULL)
         AND ${t.percent} IS NOT NULL
         AND NOT (${t.accountId} IS NOT NULL AND ${t.liabilityId} IS NOT NULL))
      )`,
    ),
  ],
);

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
  assetType: varchar("asset_type", { length: 32 }).notNull().default("other"),
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

// Pairwise correlations between asset classes, used by the Monte Carlo
// simulator. Stored canonically (assetClassIdA < assetClassIdB) so each pair
// has a single row — callers reconstruct the symmetric matrix in memory.
// Missing pairs are treated as independent (ρ = 0) per the eMoney whitepaper.
export const assetClassCorrelations = pgTable(
  "asset_class_correlations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    assetClassIdA: uuid("asset_class_id_a")
      .notNull()
      .references(() => assetClasses.id, { onDelete: "cascade" }),
    assetClassIdB: uuid("asset_class_id_b")
      .notNull()
      .references(() => assetClasses.id, { onDelete: "cascade" }),
    correlation: decimal("correlation", { precision: 6, scale: 5 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("asset_class_correlations_pair_uniq").on(t.assetClassIdA, t.assetClassIdB)]
);

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
  insuredPerson: insuredPersonEnum("insured_person"),
  value: decimal("value", { precision: 15, scale: 2 }).notNull().default("0"),
  basis: decimal("basis", { precision: 15, scale: 2 }).notNull().default("0"),
  // Null means: inherit the default for this category from plan_settings.
  growthRate: decimal("growth_rate", { precision: 5, scale: 4 }),
  rmdEnabled: boolean("rmd_enabled").notNull().default(false),
  // Optional override of the prior calendar-year-end balance used for the
  // first projection year's RMD calculation. The IRS requires RMDs to be
  // computed off the Dec-31 balance; if `value` was entered mid-year (so it
  // isn't a true Dec-31 snapshot), set this to align Year-1 RMDs with the
  // custodian's letter. Ignored after Year 1 (the engine tracks year-end
  // balances itself).
  priorYearEndValue: decimal("prior_year_end_value", { precision: 15, scale: 2 }),
  // Exactly one account per (client, scenario) has this flag set. Household income is
  // paid into this account and expenses, taxes, and savings are drawn from it; when it
  // goes negative the engine pulls from the withdrawal strategy to top it up.
  isDefaultChecking: boolean("is_default_checking").notNull().default(false),
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

export const accountOwners = pgTable(
  "account_owners",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    familyMemberId: uuid("family_member_id").references(() => familyMembers.id, {
      onDelete: "cascade",
    }),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    percent: decimal("percent", { precision: 6, scale: 4 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    exactlyOneOwner: check(
      "account_owners_one_owner",
      sql`(${t.familyMemberId} IS NOT NULL)::int + (${t.entityId} IS NOT NULL)::int = 1`,
    ),
    uniqOwner: unique("account_owners_uniq")
      .on(t.accountId, t.familyMemberId, t.entityId)
      .nullsNotDistinct(),
  }),
);

export const lifeInsurancePolicies = pgTable("life_insurance_policies", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  faceValue: decimal("face_value", { precision: 15, scale: 2 }).notNull().default("0"),
  costBasis: decimal("cost_basis", { precision: 15, scale: 2 }).notNull().default("0"),
  premiumAmount: decimal("premium_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  premiumYears: integer("premium_years"),
  policyType: policyTypeEnum("policy_type").notNull(),
  termIssueYear: integer("term_issue_year"),
  termLengthYears: integer("term_length_years"),
  endsAtInsuredRetirement: boolean("ends_at_insured_retirement").notNull().default(false),
  cashValueGrowthMode: cashValueGrowthModeEnum("cash_value_growth_mode")
    .notNull()
    .default("basic"),
  postPayoutMergeAccountId: uuid("post_payout_merge_account_id").references(
    () => accounts.id,
    { onDelete: "set null" },
  ),
  postPayoutGrowthRate: decimal("post_payout_growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.06"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const lifeInsuranceCashValueSchedule = pgTable(
  "life_insurance_cash_value_schedule",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    policyId: uuid("policy_id")
      .notNull()
      .references(() => lifeInsurancePolicies.accountId, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    cashValue: decimal("cash_value", { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    policyYearUnique: unique().on(table.policyId, table.year),
  }),
);

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
  ssBenefitMode: text("ss_benefit_mode"),
  piaMonthly: decimal("pia_monthly", { precision: 15, scale: 2 }),
  claimingAgeMonths: integer("claiming_age_months").default(0),
  claimingAgeMode: text("claiming_age_mode"),
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
  sourcePolicyAccountId: uuid("source_policy_account_id").references(
    () => accounts.id,
    { onDelete: "set null" },
  ),
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
  isInterestDeductible: boolean("is_interest_deductible").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const liabilityOwners = pgTable(
  "liability_owners",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    liabilityId: uuid("liability_id")
      .notNull()
      .references(() => liabilities.id, { onDelete: "cascade" }),
    familyMemberId: uuid("family_member_id").references(() => familyMembers.id, {
      onDelete: "cascade",
    }),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    percent: decimal("percent", { precision: 6, scale: 4 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    exactlyOneOwner: check(
      "liability_owners_one_owner",
      sql`(${t.familyMemberId} IS NOT NULL)::int + (${t.entityId} IS NOT NULL)::int = 1`,
    ),
    uniqOwner: unique("liability_owners_uniq")
      .on(t.liabilityId, t.familyMemberId, t.entityId)
      .nullsNotDistinct(),
  }),
);

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
  // When true, the engine resolves the rule to the applicable IRS limit for
  // the owner's age and account subtype each year, overriding annualAmount /
  // annualPercent. Only meaningful for retirement subtypes.
  contributeMax: boolean("contribute_max").notNull().default(false),
  annualLimit: decimal("annual_limit", { precision: 15, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientOpenItems = pgTable(
  "client_open_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    priority: openItemPriorityEnum("priority").notNull().default("medium"),
    dueDate: date("due_date"),
    completedAt: timestamp("completed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("client_open_items_client_completed_idx").on(t.clientId, t.completedAt),
  ],
);

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

export const externalBeneficiariesRelations = relations(
  externalBeneficiaries,
  ({ one, many }) => ({
    client: one(clients, {
      fields: [externalBeneficiaries.clientId],
      references: [clients.id],
    }),
    designations: many(beneficiaryDesignations),
  }),
);

export const beneficiaryDesignationsRelations = relations(
  beneficiaryDesignations,
  ({ one }) => ({
    client: one(clients, {
      fields: [beneficiaryDesignations.clientId],
      references: [clients.id],
    }),
    account: one(accounts, {
      fields: [beneficiaryDesignations.accountId],
      references: [accounts.id],
    }),
    entity: one(entities, {
      fields: [beneficiaryDesignations.entityId],
      references: [entities.id],
    }),
    familyMember: one(familyMembers, {
      fields: [beneficiaryDesignations.familyMemberId],
      references: [familyMembers.id],
    }),
    externalBeneficiary: one(externalBeneficiaries, {
      fields: [beneficiaryDesignations.externalBeneficiaryId],
      references: [externalBeneficiaries.id],
    }),
  }),
);

export const giftsRelations = relations(gifts, ({ one }) => ({
  client: one(clients, {
    fields: [gifts.clientId],
    references: [clients.id],
  }),
  recipientEntity: one(entities, {
    fields: [gifts.recipientEntityId],
    references: [entities.id],
  }),
  recipientFamilyMember: one(familyMembers, {
    fields: [gifts.recipientFamilyMemberId],
    references: [familyMembers.id],
  }),
  recipientExternalBeneficiary: one(externalBeneficiaries, {
    fields: [gifts.recipientExternalBeneficiaryId],
    references: [externalBeneficiaries.id],
  }),
}));

// ── Gift Series ───────────────────────────────────────────────────────────────

export const giftSeries = pgTable(
  "gift_series",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "cascade" }),
    grantor: ownerEnum("grantor").notNull(),
    recipientEntityId: uuid("recipient_entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    startYear: integer("start_year").notNull(),
    startYearRef: yearRefEnum("start_year_ref"),
    endYear: integer("end_year").notNull(),
    endYearRef: yearRefEnum("end_year_ref"),
    annualAmount: decimal("annual_amount", { precision: 15, scale: 2 }).notNull(),
    inflationAdjust: boolean("inflation_adjust").notNull().default(false),
    useCrummeyPowers: boolean("use_crummey_powers").notNull().default(false),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("gift_series_recipient_idx").on(t.recipientEntityId),
    index("gift_series_client_idx").on(t.clientId),
    check("gift_series_year_order", sql`${t.endYear} >= ${t.startYear}`),
  ],
);

export const giftSeriesRelations = relations(giftSeries, ({ one }) => ({
  client: one(clients, { fields: [giftSeries.clientId], references: [clients.id] }),
  scenario: one(scenarios, { fields: [giftSeries.scenarioId], references: [scenarios.id] }),
  recipientEntity: one(entities, {
    fields: [giftSeries.recipientEntityId],
    references: [entities.id],
  }),
}));

// ── Wills (spec 4a) ──────────────────────────────────────────────────

export const willGrantorEnum = pgEnum("will_grantor", ["client", "spouse"]);
export const willAssetModeEnum = pgEnum("will_asset_mode", [
  "specific",
  "all_assets",
]);
export const willConditionEnum = pgEnum("will_condition", [
  "if_spouse_survives",
  "if_spouse_predeceased",
  "always",
]);
export const willRecipientKindEnum = pgEnum("will_recipient_kind", [
  "family_member",
  "external_beneficiary",
  "entity",
  "spouse",
]);

export const willBequestKindEnum = pgEnum("will_bequest_kind", [
  "asset",
  "liability",
]);

export const wills = pgTable(
  "wills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    grantor: willGrantorEnum("grantor").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("wills_client_grantor_idx").on(t.clientId, t.grantor),
  ],
);

export const willBequests = pgTable(
  "will_bequests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    willId: uuid("will_id")
      .notNull()
      .references(() => wills.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: willBequestKindEnum("kind").notNull(),
    assetMode: willAssetModeEnum("asset_mode"),
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "cascade",
    }),
    liabilityId: uuid("liability_id").references(() => liabilities.id, {
      onDelete: "cascade",
    }),
    percentage: numeric("percentage", { precision: 5, scale: 2 }).notNull(),
    condition: willConditionEnum("condition").notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("will_bequests_will_sort_idx").on(t.willId, t.sortOrder),
    uniqueIndex("will_bequests_liability_idx")
      .on(t.willId, t.liabilityId)
      .where(sql`${t.kind} = 'liability'`),
  ],
);

export const willBequestRecipients = pgTable("will_bequest_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  bequestId: uuid("bequest_id")
    .notNull()
    .references(() => willBequests.id, { onDelete: "cascade" }),
  recipientKind: willRecipientKindEnum("recipient_kind").notNull(),
  recipientId: uuid("recipient_id"),
  percentage: numeric("percentage", { precision: 5, scale: 2 }).notNull(),
  sortOrder: integer("sort_order").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const willsRelations = relations(wills, ({ one, many }) => ({
  client: one(clients, { fields: [wills.clientId], references: [clients.id] }),
  bequests: many(willBequests),
}));

export const willBequestsRelations = relations(willBequests, ({ one, many }) => ({
  will: one(wills, { fields: [willBequests.willId], references: [wills.id] }),
  account: one(accounts, {
    fields: [willBequests.accountId],
    references: [accounts.id],
  }),
  liability: one(liabilities, {
    fields: [willBequests.liabilityId],
    references: [liabilities.id],
  }),
  recipients: many(willBequestRecipients),
}));

export const willBequestRecipientsRelations = relations(
  willBequestRecipients,
  ({ one }) => ({
    bequest: one(willBequests, {
      fields: [willBequestRecipients.bequestId],
      references: [willBequests.id],
    }),
  }),
);

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

export const scenarioToggleGroupsRelations = relations(scenarioToggleGroups, ({ one }) => ({
  scenario: one(scenarios, {
    fields: [scenarioToggleGroups.scenarioId],
    references: [scenarios.id],
  }),
  requiresGroup: one(scenarioToggleGroups, {
    fields: [scenarioToggleGroups.requiresGroupId],
    references: [scenarioToggleGroups.id],
    relationName: "toggle_group_requires",
  }),
}));

export const scenarioChangesRelations = relations(scenarioChanges, ({ one }) => ({
  scenario: one(scenarios, {
    fields: [scenarioChanges.scenarioId],
    references: [scenarios.id],
  }),
  toggleGroup: one(scenarioToggleGroups, {
    fields: [scenarioChanges.toggleGroupId],
    references: [scenarioToggleGroups.id],
  }),
}));

export const scenarioSnapshotsRelations = relations(scenarioSnapshots, ({ one }) => ({
  client: one(clients, {
    fields: [scenarioSnapshots.clientId],
    references: [clients.id],
  }),
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
  policy: one(lifeInsurancePolicies, {
    fields: [accounts.id],
    references: [lifeInsurancePolicies.accountId],
    relationName: "policyAccount",
  }),
  mergingPolicies: many(lifeInsurancePolicies, {
    relationName: "mergeTargetAccount",
  }),
}));

export const lifeInsurancePoliciesRelations = relations(lifeInsurancePolicies, ({ one, many }) => ({
  account: one(accounts, {
    fields: [lifeInsurancePolicies.accountId],
    references: [accounts.id],
    relationName: "policyAccount",
  }),
  mergeTargetAccount: one(accounts, {
    fields: [lifeInsurancePolicies.postPayoutMergeAccountId],
    references: [accounts.id],
    relationName: "mergeTargetAccount",
  }),
  cashValueSchedule: many(lifeInsuranceCashValueSchedule),
}));

export const lifeInsuranceCashValueScheduleRelations = relations(
  lifeInsuranceCashValueSchedule,
  ({ one }) => ({
    policy: one(lifeInsurancePolicies, {
      fields: [lifeInsuranceCashValueSchedule.policyId],
      references: [lifeInsurancePolicies.accountId],
    }),
  }),
);

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

  // Compressed trust brackets — null rows fall back to single-status brackets in the resolver.
  trustIncomeBrackets: jsonb("trust_income_brackets").$type<BracketTier[]>(),
  trustCapGainsBrackets: jsonb("trust_cap_gains_brackets").$type<BracketTier[]>(),

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

  giftAnnualExclusion: decimal("gift_annual_exclusion", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),

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

// Audit log. Append-only record of mutating actions against tenant
// data. Keeps a 7-year retention window by policy (dropped via a cron
// outside the app). No FK to clients/firm on purpose — the table must
// survive cascade-deletes so a "compromised advisor nuked everything"
// incident still has a log trail.
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id").notNull(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    clientId: uuid("client_id"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_log_firm_created_idx").on(t.firmId, t.createdAt),
    index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
  ],
);

// ── Billing & SOC 2 (Phase 1) ────────────────────────────────────────────────

// Root row per Clerk org. Holds firm-level metadata that doesn't fit on
// a Stripe object (founder flag, archival lifecycle, DPA acceptance).
// `firm_id` matches the Clerk org id verbatim — no separate surrogate key,
// because every other firm-scoped table already keys on Clerk org id.
export const firms = pgTable("firms", {
  firmId: text("firm_id").primaryKey(),
  displayName: text("display_name"),
  isFounder: boolean("is_founder").default(false).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  dataRetentionUntil: timestamp("data_retention_until", { withTimezone: true }),
  purgedAt: timestamp("purged_at", { withTimezone: true }),
  dpaVersion: text("dpa_version"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One Stripe subscription per firm. UNIQUE filter ensures a firm can only
// have one *live* sub at a time — canceled rows stay for history.
// `current_period_*` mirrors Stripe so middleware can compute grace
// windows without an API call.
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.firmId, { onDelete: "cascade" }),
    stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    status: text("status").notNull(),
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    trialStart: timestamp("trial_start", { withTimezone: true }),
    trialEnd: timestamp("trial_end", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("subscriptions_firm_status_idx").on(t.firmId, t.status),
    uniqueIndex("subscriptions_firm_active_unique")
      .on(t.firmId)
      .where(sql`status IN ('trialing','active','past_due','unpaid')`),
  ],
);

// Stripe subscription items — one per seat line + one per add-on.
// `kind` distinguishes seats (quantity tracks org membership) from
// add-ons (quantity is always 1, presence = entitlement).
// `removed_at` is set when an add-on is toggled off; row stays
// for history and to satisfy SOC 2 CC7.2 auditability.
export const subscriptionItems = pgTable(
  "subscription_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.firmId, { onDelete: "cascade" }),
    stripeItemId: text("stripe_item_id").notNull().unique(),
    stripePriceId: text("stripe_price_id").notNull(),
    kind: text("kind").notNull(), // 'seat' | 'addon'
    addonKey: text("addon_key"),
    quantity: integer("quantity").default(1).notNull(),
    unitAmount: integer("unit_amount").notNull(), // cents
    currency: text("currency").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    index("subscription_items_firm_kind_idx").on(t.firmId, t.kind),
    check(
      "subscription_items_kind_check",
      sql`${t.kind} IN ('seat','addon')`,
    ),
    check(
      "subscription_items_addon_key_when_addon",
      sql`(${t.kind} = 'addon' AND ${t.addonKey} IS NOT NULL) OR (${t.kind} = 'seat' AND ${t.addonKey} IS NULL)`,
    ),
  ],
);

// Mirror of Stripe invoices. We never re-render — `hosted_invoice_url`
// and `invoice_pdf` are Stripe-hosted and good for the life of the
// invoice. Row exists so the in-app billing page can list invoices
// without a Stripe API roundtrip per pageload.
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.firmId, { onDelete: "cascade" }),
    stripeInvoiceId: text("stripe_invoice_id").notNull().unique(),
    stripeCustomerId: text("stripe_customer_id").notNull(),
    stripeSubscriptionId: text("stripe_subscription_id"),
    status: text("status"),
    amountDue: integer("amount_due"),
    amountPaid: integer("amount_paid"),
    currency: text("currency"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdf: text("invoice_pdf"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("invoices_firm_paid_idx").on(t.firmId, t.paidAt)],
);
