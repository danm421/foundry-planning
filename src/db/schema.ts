import {
  pgTable,
  uuid,
  text,
  date,
  integer,
  decimal,
  doublePrecision,
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
  customType,
  foreignKey,
  bigint,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations, sql, type InferSelectModel, type InferInsertModel } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { BracketTier } from "@/lib/tax/types";
import type { IrmaaTier } from "@/engine/types";
import type { TrustSubType } from "@/lib/entities/trust";
import type { IntakePayload } from "@/lib/intake/schema";
import type { ReportLayoutEntry } from "@/lib/solver/report-layout";

const inet = customType<{ data: string; driverData: string }>({
  dataType() {
    return "inet";
  },
});

// pgvector column. drizzle-kit can't fully express vector(N) or the HNSW
// index — the migration's CREATE EXTENSION + index step is hand-edited
// (see migration <NNNN>). Mirrors the `inet` customType precedent above.
const vector1536 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
});

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
  "annuity",
  "real_estate",
  "business",
  "life_insurance",
  "notes_receivable",
  "stock_options",
  "education_savings",
]);

export const grantTypeEnum = pgEnum("grant_type", ["rsu", "nqso", "iso"]);
export const equityExerciseTimingEnum = pgEnum("equity_exercise_timing", [
  "at_vest",
  "specific_year",
  "year_before_expiration",
  "manual",
]);
export const equitySellTimingEnum = pgEnum("equity_sell_timing", [
  "immediately",
  "hold_then_sell_year",
  "percent_per_year",
  "hold",
]);
export const equityPlannedActionEnum = pgEnum("equity_planned_action", ["exercise", "sell"]);

export const accountSubTypeEnum = pgEnum("account_sub_type", [
  "brokerage",
  "savings",
  "checking",
  "traditional_ira",
  "roth_ira",
  "401k",
  "403b",
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
  // Phase 3 — Plaid coverage (cash + retirement subtypes Plaid returns)
  "hsa",
  "cd",
  "money_market",
  "sep_ira",
  "simple_ira",
  "401a",
]);

export const hsaCoverageEnum = pgEnum("hsa_coverage", ["self", "family"]);

export const accountBusinessTypeEnum = pgEnum("account_business_type", [
  "sole_prop",
  "partnership",
  "s_corp",
  "c_corp",
  "llc",
  "other",
]);

export const ownerEnum = pgEnum("owner", ["client", "spouse", "joint"]);

export const giftAmountModeEnum = pgEnum("gift_amount_mode", [
  "fixed",
  "annual_exclusion",
]);

export const titlingTypeEnum = pgEnum("titling_type", [
  "jtwros",
  "community_property",
]);

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

export const premiumPayerEnum = pgEnum("premium_payer", [
  "owner",
  "client",
  "spouse",
  "both",
]);

export const scheduleModeEnum = pgEnum("li_schedule_mode", ["off", "scheduled"]);

export const entityGrantorEnum = pgEnum("entity_grantor_enum", ["client", "spouse"]);

export const entityFlowModeEnum = pgEnum("entity_flow_mode", ["annual", "schedule"]);

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
  "education",
]);

export const sourceEnum = pgEnum("source", ["manual", "extracted", "policy", "orion", "plaid"]);

export const holdingSourceEnum = pgEnum("holding_source", ["manual", "plaid"]);

export const liabilityTypeEnum = pgEnum("liability_type", [
  "mortgage",
  "heloc",
  "auto",
  "student",
  "personal",
  "credit_card",
  "other",
]);

export const transactionCategorizedByEnum = pgEnum("transaction_categorized_by", [
  "plaid",
  "rule",
  "manual",
  "recurring",
]);

export const recurringCadenceEnum = pgEnum("recurring_cadence", [
  "monthly",
  "annually",
]);

export const transactionCategoryKindEnum = pgEnum("transaction_category_kind", [
  "group",
  "category",
]);

export const transactionTypeEnum = pgEnum("transaction_type", [
  "income",
  "expense",
  "transfer",
]);

export const transactionSourceEnum = pgEnum("transaction_source", ["plaid", "manual"]);

export const transactionMatchTypeEnum = pgEnum("transaction_match_type", [
  "exact",
  "contains",
]);

export const importOriginEnum = pgEnum("import_origin", ["extraction", "orion"]);

export const orionConnectionStatusEnum = pgEnum("orion_connection_status", [
  "connected",
  "disconnected",
  "error",
]);

export const orionSyncTriggerEnum = pgEnum("orion_sync_trigger", ["manual", "cron"]);

export const entityTypeEnum = pgEnum("entity_type", [
  "trust",
  "llc",
  "s_corp",
  "c_corp",
  "partnership",
  "foundation",
  "other",
]);

export const entityTaxTreatmentEnum = pgEnum("entity_tax_treatment", [
  "qbi",
  "ordinary",
  "non_taxable",
]);

export const familyRelationshipEnum = pgEnum("family_relationship", [
  "child",
  "stepchild",
  "grandchild",
  "great_grandchild",
  "parent",
  "grandparent",
  "sibling",
  "sibling_in_law",
  "child_in_law",
  "niece_nephew",
  "aunt_uncle",
  "cousin",
  "grand_aunt_uncle",
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

export const distributionFormEnum = pgEnum("distribution_form", [
  "in_trust",
  "outright",
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
  // `revocable` is a DEPRECATED orphan: revocable trusts are now modeled as a
  // tag (separate table), not as an entity. The value is intentionally retained
  // in this pgEnum so drizzle-kit does NOT emit a DROP VALUE migration — the
  // live Postgres column still allows it and legacy rows may hold it. It is no
  // longer a member of the app-level TrustSubType union (see lib/entities/trust).
  "revocable",
  "irrevocable",
  "ilit",
  "clt",
  "idgt",
  "crt",
]);
// Compile-time guard: every app-level TrustSubType member must exist in this DB
// enum (forward direction stays strict — a new union member missing from the DB
// enum breaks tsc). The reverse direction is NOT asserted, because the DB enum
// intentionally carries the deprecated `revocable` orphan that the app union
// dropped. See canonical union: src/lib/entities/trust.ts → TRUST_SUB_TYPES.
type _TrustSubTypeEnumValues = (typeof trustSubTypeEnum.enumValues)[number];
const _assertTrustSubTypeInEnum: _TrustSubTypeEnumValues = null as unknown as TrustSubType;
void _assertTrustSubTypeInEnum;

export const trustTermTypeEnum = pgEnum("trust_term_type", [
  "years",
  "single_life",
  "joint_life",
  "shorter_of_years_or_life",
]);

export const notePaymentTypeEnum = pgEnum("note_payment_type", [
  "amortizing",
  "interest_only_balloon",
]);

export const trustPayoutTypeEnum = pgEnum("trust_payout_type", [
  "unitrust",
  "annuity",
]);

export const giftEventKindEnum = pgEnum("gift_event_kind", [
  "outright",
  "clt_remainder_interest",
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
  "ticker_portfolio",
  "custom",
  "asset_mix",
  "inflation",
  "holdings",
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

export const planObservationSectionEnum = pgEnum("plan_observation_section", [
  "observation",
  "next_step",
]);
export const planObservationTopicEnum = pgEnum("plan_observation_topic", [
  "retirement",
  "cash-flow",
  "investments",
  "tax",
  "insurance",
  "estate",
  "education",
  "general",
]);
export const planObservationStatusEnum = pgEnum("plan_observation_status", [
  "open",
  "in_progress",
  "done",
]);
export const planObservationOwnerEnum = pgEnum("plan_observation_owner", [
  "advisor",
  "client",
  "joint",
]);
export const planObservationSourceEnum = pgEnum("plan_observation_source", [
  "manual",
  "ai",
]);

export const importModeEnum = pgEnum("import_mode", ["onboarding", "updating"]);

export const importStatusEnum = pgEnum("import_status", [
  "draft",
  "extracting",
  "review",
  "committed",
  "discarded",
]);

export const extractionStatusEnum = pgEnum("extraction_status", [
  "queued",
  "extracting",
  "success",
  "failed",
]);

export const importDocumentTypeEnum = pgEnum("import_document_type", [
  "auto",
  "account_statement",
  "pay_stub",
  "insurance",
  "expense_worksheet",
  "tax_return",
  "excel_import",
  "fact_finder",
  "will",
  "family_fact_finder",
]);

export const extractionModelEnum = pgEnum("extraction_model", ["mini", "full"]);

export const intakeModeEnum = pgEnum("intake_mode", ["blank", "prefilled"]);
export const intakeStatusEnum = pgEnum("intake_status", [
  "draft",
  "submitted",
  "applied",
  "discarded",
  "expired",
]);

// ── CRM enums ────────────────────────────────────────────────────────────────

export const crmHouseholdStatusEnum = pgEnum("crm_household_status", [
  "prospect",
  "active",
  "inactive",
  "archived",
]);

export const crmContactRoleEnum = pgEnum("crm_contact_role", [
  "primary",
  "spouse",
  "dependent",
  "other",
]);

export const crmActivityKindEnum = pgEnum("crm_activity_kind", [
  "note",
  "call",
  "meeting",
  "email",
  "status_change",
  "contact_change",
  "account_change",
  "document_uploaded",
  "planning_link",
]);

export const crmDocumentSourceKindEnum = pgEnum("crm_document_source_kind", [
  "upload",
  "generated_plan",
  "import_ref",
]);

// ── CRM tables ───────────────────────────────────────────────────────────────

export const crmHouseholds = pgTable("crm_households", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  advisorId: text("advisor_id").notNull(),
  name: text("name").notNull(),
  status: crmHouseholdStatusEnum("status").notNull().default("prospect"),
  notes: text("notes"),
  // Canonical household residence (USPS 2-letter code; 50 states + DC).
  // Nullable: pre-existing households predate this and are not backfilled.
  // Required at creation via createCrmHouseholdInteractiveSchema, not NOT NULL.
  state: text("state"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Soft-delete (Trash). null = live; set = in Trash, recoverable until the
  // daily purge cron removes it 60 days after deletedAt.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedBy: text("deleted_by"),
}, (t) => [
  index("crm_households_firm_idx").on(t.firmId),
  index("crm_households_firm_status_idx").on(t.firmId, t.status),
  index("crm_households_firm_deleted_idx").on(t.firmId, t.deletedAt),
]);

export const crmHouseholdContacts = pgTable("crm_household_contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => crmHouseholds.id, { onDelete: "cascade" }),
  role: crmContactRoleEnum("role").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  preferredName: text("preferred_name"),
  dateOfBirth: date("date_of_birth"),
  email: text("email"),
  phone: text("phone"),
  mobile: text("mobile"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country"),
  ssnLast4: text("ssn_last4"),
  maritalStatus: text("marital_status"),
  employmentStatus: text("employment_status"),
  employer: text("employer"),
  occupation: text("occupation"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("crm_contacts_household_idx").on(t.householdId),
  index("crm_contacts_name_idx").on(t.lastName, t.firstName),
  uniqueIndex("crm_contacts_one_primary_per_household")
    .on(t.householdId)
    .where(sql`role = 'primary'`),
  uniqueIndex("crm_contacts_one_spouse_per_household")
    .on(t.householdId)
    .where(sql`role = 'spouse'`),
]);

export const crmHouseholdAccounts = pgTable("crm_household_accounts", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => crmHouseholds.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id")
    .references(() => crmHouseholdContacts.id, { onDelete: "set null" }),
  accountType: text("account_type"),
  custodian: text("custodian"),
  accountNumberLast4: text("account_number_last4"),
  balance: numeric("balance", { precision: 14, scale: 2 }),
  balanceAsOf: date("balance_as_of"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("crm_accounts_household_idx").on(t.householdId),
]);

export const crmActivity = pgTable("crm_activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => crmHouseholds.id, { onDelete: "cascade" }),
  firmId: text("firm_id").notNull(),
  actorUserId: text("actor_user_id"),
  kind: crmActivityKindEnum("kind").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurred_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("crm_activity_household_occurred_idx").on(t.householdId, t.occurredAt.desc()),
]);

// Per-user "recently opened" tracking. One row per (user, household); the
// open timestamp is upserted each time the advisor clicks into CRM/Planning
// from the clients list. Powers the "Recently opened" filter.
export const crmHouseholdViews = pgTable("crm_household_views", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => crmHouseholds.id, { onDelete: "cascade" }),
  firmId: text("firm_id").notNull(),
  userId: text("user_id").notNull(),
  openedAt: timestamp("opened_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("crm_household_views_user_household_uq").on(t.userId, t.householdId),
  index("crm_household_views_firm_user_opened_idx").on(
    t.firmId,
    t.userId,
    t.openedAt.desc(),
  ),
]);

export const crmHouseholdDocuments = pgTable("crm_household_documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => crmHouseholds.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  storageProvider: text("storage_provider").notNull(),
  storageKey: text("storage_key"),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  uploadedBy: text("uploaded_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  folderId: uuid("folder_id").references(() => crmDocumentFolders.id, {
    onDelete: "set null",
  }),
  sourceKind: crmDocumentSourceKindEnum("source_kind").notNull().default("upload"),
  description: text("description"),
  versionGroupId: uuid("version_group_id"),
  versionNo: integer("version_no").notNull().default(1),
  isCurrentVersion: boolean("is_current_version").notNull().default(true),
  importFileId: uuid("import_file_id").references(() => clientImportFiles.id, {
    onDelete: "set null",
  }),
  reportType: text("report_type"),
  scenarioId: uuid("scenario_id").references(() => scenarios.id, {
    onDelete: "set null",
  }),
}, (t) => [
  index("crm_documents_household_idx").on(t.householdId),
  index("crm_documents_version_group_idx").on(t.versionGroupId),
  index("crm_documents_folder_idx").on(t.folderId),
]);

export const crmDocumentFolders = pgTable("crm_document_folders", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => crmHouseholds.id, { onDelete: "cascade" }),
  firmId: text("firm_id").notNull(),
  parentFolderId: uuid("parent_folder_id").references(
    (): AnyPgColumn => crmDocumentFolders.id,
    { onDelete: "set null" },
  ),
  name: text("name").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  // Exactly one folder per household carries is_portal_root = true: the
  // "Shared with Client" root that the client portal mounts. It is the
  // security boundary — the portal only ever touches this folder's subtree.
  isPortalRoot: boolean("is_portal_root").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("crm_document_folders_household_idx").on(t.householdId),
  index("crm_document_folders_parent_idx").on(t.householdId, t.parentFolderId),
  uniqueIndex("crm_doc_folders_one_portal_root_per_hh")
    .on(t.householdId)
    .where(sql`${t.isPortalRoot}`),
]);

export const generationRunStatusEnum = pgEnum("generation_run_status", [
  "queued",
  // Presentation runs generate the Retirement Comparison AI commentary as their
  // final data step before rendering; this phase surfaces as "Analyzing…".
  "analyzing",
  "running",
  "done",
  "failed",
]);

export const generationRuns = pgTable("generation_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => crmHouseholds.id, { onDelete: "cascade" }),
  // was: .notNull() — meeting-prep runs exist for households with no planning client
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  firmId: text("firm_id").notNull(),

  kind: text("kind").notNull(),
  status: generationRunStatusEnum("status").notNull().default("queued"),

  triggeredBy: text("triggered_by"),
  triggeredByEmail: text("triggered_by_email"),

  scenarioId: uuid("scenario_id").references(() => scenarios.id, {
    onDelete: "set null",
  }),
  requestPayload: jsonb("request_payload"),
  // Meeting-prep runs park their finished {draft, data} here (no vault doc).
  // Null for presentation runs, whose result is resultDocumentId.
  resultPayload: jsonb("result_payload"),
  resultDocumentId: uuid("result_document_id").references(
    () => crmHouseholdDocuments.id,
    { onDelete: "set null" },
  ),
  // Set only for compliance-export batch children; links a per-client run to
  // its parent batch. Null for single-client presentation / meeting-prep runs.
  batchId: uuid("batch_id").references(() => complianceExportBatches.id, {
    onDelete: "cascade",
  }),
  error: text("error"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
}, (t) => [
  index("generation_runs_household_idx").on(t.householdId, t.createdAt),
  index("generation_runs_status_idx").on(t.status, t.createdAt),
  index("generation_runs_batch_idx").on(t.batchId, t.status),
]);

// Parent aggregator for a firm-wide compliance presentation export. Per-client
// work lives in generation_runs (kind='compliance_export', batchId FK below);
// skips (no planning client / no base case) are recorded here, not as runs.
export const complianceExportBatchStatusEnum = pgEnum(
  "compliance_export_batch_status",
  ["queued", "running", "done", "done_with_errors", "failed"],
);

export const complianceExportBatches = pgTable("compliance_export_batches", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  status: complianceExportBatchStatusEnum("status").notNull().default("queued"),
  triggeredBy: text("triggered_by"),
  triggeredByEmail: text("triggered_by_email"),
  // Count of renderable clients we enqueued a run for (excludes skips).
  totalClients: integer("total_clients").notNull().default(0),
  // The exact deck rendered, for audit + future deck variation.
  deckSpec: jsonb("deck_spec"),
  // [{ householdId, name, reason }] — clients we could not snapshot.
  skippedClients: jsonb("skipped_clients"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
}, (t) => [
  index("compliance_export_batches_firm_idx").on(t.firmId, t.createdAt),
  index("compliance_export_batches_status_idx").on(t.status),
]);

// Forge meeting-transcript staging. A pasted/attached transcript is stashed here
// out-of-band (never enters the model's chat context); summarize_meeting_transcript
// reads it, save_meeting_record commits it to a CRM document + deletes the row.
export const forgeMeetingTranscripts = pgTable("forge_meeting_transcripts", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  householdId: uuid("household_id")
    .notNull()
    .references(() => crmHouseholds.id, { onDelete: "cascade" }),
  firmId: text("firm_id").notNull(),
  conversationId: text("conversation_id"),
  rawText: text("raw_text").notNull(),
  wordCount: integer("word_count").notNull().default(0),
  // 'paste' (auto-detected) | 'explicit' (advisor used the Transcript affordance)
  source: text("source").notNull().default("paste"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("forge_meeting_transcripts_client_idx").on(t.clientId, t.createdAt),
]);

// ── Tables ───────────────────────────────────────────────────────────────────

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  advisorId: text("advisor_id").notNull(),
  retirementAge: integer("retirement_age").notNull(),
  // Calendar month (1-12) within the retirement year when retirement starts.
  // Income/expenses linked to the retirement transition are pro-rated for this
  // month: end-at-retirement items run Jan..(month-1), start-at-retirement items
  // run month..Dec. Defaults to 1 (January) — matches legacy whole-year behavior.
  retirementMonth: integer("retirement_month").notNull().default(1),
  planEndAge: integer("plan_end_age").notNull(),
  // Life expectancies are the source of truth for the plan horizon; plan_end_age
  // is derived (= max(death year across client + spouse) - clientBirthYear).
  lifeExpectancy: integer("life_expectancy").notNull().default(95),
  spouseRetirementAge: integer("spouse_retirement_age"),
  spouseRetirementMonth: integer("spouse_retirement_month"),
  spouseLifeExpectancy: integer("spouse_life_expectancy"),
  filingStatus: filingStatusEnum("filing_status").notNull().default("single"),
  // Excludes this client from the owner's share-all grants. Default false
  // (sweepable). An explicit per-client share is honored even when private.
  isPrivate: boolean("is_private").notNull().default(false),
  onboardingState: jsonb("onboarding_state").notNull().default({}),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  quickStartState: jsonb("quick_start_state").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  crmHouseholdId: uuid("crm_household_id")
    .notNull()
    .unique()
    .references(() => crmHouseholds.id, { onDelete: "restrict" }),
  clerkUserId: text("clerk_user_id").unique(),
  portalInvitedAt: timestamp("portal_invited_at"),
  portalEditEnabled: boolean("portal_edit_enabled").notNull().default(true),
}, (t) => [
  index("clients_firm_idx").on(t.firmId),
]);

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
}, (t) => ({
  // Scenarios are listed per client (engine load + base-case lookup) (audit F7).
  clientIdx: index("scenarios_client_idx").on(t.clientId),
}));

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
}, (t) => ({
  // Toggle groups are listed per scenario (audit F7).
  scenarioIdx: index("scenario_toggle_groups_scenario_idx").on(t.scenarioId),
}));

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
  // When false the loader skips this change before applying overlays; the row
  // stays in place so the user can flip it back without re-creating.
  enabled: boolean("enabled").notNull().default(true),
  // User-supplied display label for this change. Null = render the computed
  // smart label; non-null = show verbatim (replaces the whole "Kind — name"
  // title). Display-only; never reaches the projection engine.
  label: text("label"),
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
}, (t) => ({
  // Snapshots are listed per client (audit F7).
  clientIdx: index("scenario_snapshots_client_idx").on(t.clientId),
}));

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
  residenceState: text("residence_state"),
  irdTaxRate: decimal("ird_tax_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.3500"),
  probateCostRate: decimal("probate_cost_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.0200"),
  pvDiscountRate: decimal("pv_discount_rate", { precision: 5, scale: 4 }),
  priorTaxableGiftsClient: decimal("prior_taxable_gifts_client", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  priorTaxableGiftsSpouse: decimal("prior_taxable_gifts_spouse", { precision: 15, scale: 2 })
    .notNull()
    .default("0"),
  taxEngineMode: taxEngineModeEnum("tax_engine_mode").notNull().default("bracket"),
  taxInflationRate: decimal("tax_inflation_rate", { precision: 5, scale: 4 }),
  lifetimeExemptionCap: decimal("lifetime_exemption_cap", { precision: 15, scale: 2 }),
  ssWageGrowthRate: decimal("ss_wage_growth_rate", { precision: 5, scale: 4 }),
  inflationRate: decimal("inflation_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
  medicarePremiumInflationRate: decimal("medicare_premium_inflation_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.03"),
  medicarePremiumInflationEnabled: boolean("medicare_premium_inflation_enabled")
    .notNull()
    .default(true),
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
  defaultGrowthStockOptions: decimal("default_growth_stock_options", { precision: 5, scale: 4 })
    .notNull()
    .default("0.07"),
  growthSourceTaxable: growthSourceEnum("growth_source_taxable").notNull().default("inflation"),
  modelPortfolioIdTaxable: uuid("model_portfolio_id_taxable").references(() => modelPortfolios.id, { onDelete: "set null" }),
  growthSourceCash: growthSourceEnum("growth_source_cash").notNull().default("inflation"),
  modelPortfolioIdCash: uuid("model_portfolio_id_cash").references(() => modelPortfolios.id, { onDelete: "set null" }),
  growthSourceRetirement: growthSourceEnum("growth_source_retirement").notNull().default("inflation"),
  modelPortfolioIdRetirement: uuid("model_portfolio_id_retirement").references(() => modelPortfolios.id, { onDelete: "set null" }),
  growthSourceRealEstate: growthSourceEnum("growth_source_real_estate").notNull().default("inflation"),
  growthSourceBusiness: growthSourceEnum("growth_source_business").notNull().default("inflation"),
  growthSourceLifeInsurance: growthSourceEnum("growth_source_life_insurance").notNull().default("inflation"),
  growthSourceStockOptions: growthSourceEnum("growth_source_stock_options").notNull().default("inflation"),
  selectedBenchmarkPortfolioId: uuid("selected_benchmark_portfolio_id").references(() => modelPortfolios.id, { onDelete: "set null" }),
  inflationRateSource: inflationRateSourceEnum("inflation_rate_source").notNull().default("asset_class"),
  useCustomCma: boolean("use_custom_cma").notNull().default(false),
  // Effective tax rate applied to DNI distributed to out-of-household beneficiaries
  // (non-grantor trusts with external income beneficiaries). Defaults to top federal bracket.
  outOfHouseholdDniRate: decimal("out_of_household_dni_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.37"),
  surplusSpendPct: decimal("surplus_spend_pct", { precision: 5, scale: 4 })
    .notNull()
    .default("0"),
  surplusSaveAccountId: uuid("surplus_save_account_id").references(
    () => accounts.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  // One row per (client, scenario). This unique index stops a concurrent POST /
  // retry from duplicating the row ("first row wins" silently) — audit F15.
  // scenario_id is NOT NULL, so plain uniqueness (no NULLS NOT DISTINCT) suffices.
  // The live dev DB does NOT yet have this index; the migration that adds it is
  // 0137 (hand-authored with IF NOT EXISTS, same drift class as plaid_items/F14).
  uniqueIndex("plan_settings_client_id_scenario_id_idx").on(t.clientId, t.scenarioId),
]);

export const entities = pgTable("entities", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  entityType: entityTypeEnum("entity_type").notNull().default("trust"),
  // When true, the entity's accounts roll into the household portfolio-assets view.
  includeInPortfolio: boolean("include_in_portfolio").notNull().default(false),
  // Trust-only sprinkle provision: when true (and includeInPortfolio is false), the
  // entity's assets surface in the "Accessible Trust Assets" column on the cash-flow
  // Portfolio Assets drill. Models distribution committees / HEMS / trust-protector
  // sprinkle clauses that let the client tap trust principal once household liquid
  // assets are exhausted. No-op for revocable trusts.
  accessibleToClient: boolean("accessible_to_client").notNull().default(false),
  // Trust-only: when true, contributions to the trust grant beneficiaries a
  // limited-time withdrawal right (Crummey powers), qualifying gifts for the
  // annual gift-tax exclusion. Default applied to new gifts; per-gift overrides
  // remain on the gifts table.
  crummeyPowers: boolean("crummey_powers").notNull().default(false),
  // When true, taxes on the entity's income / RMDs are paid at the household (grantor trust).
  isGrantor: boolean("is_grantor").notNull().default(false),
  // Trust-only: optional. When set and isGrantor=true, grantor-trust treatment
  // applies only through this projection year (inclusive). Past this year, the
  // trust files its own 1041. NULL → permanent grantor status (existing behavior).
  grantorStatusEndYear: integer("grantor_status_end_year"),
  // For business-interest entities (LLC/S-Corp/C-Corp/Partnership/Other): flat
  // valuation that surfaces on the balance sheet's Out of Estate section.
  // Null/zero for trust/foundation rows that hold value through child accounts.
  value: decimal("value", { precision: 15, scale: 2 }).notNull().default("0"),
  // Cost basis for business-interest entities. Used at death-event for step-up
  // analysis. Zero for trusts.
  basis: decimal("basis", { precision: 15, scale: 2 }).notNull().default("0"),
  // DEPRECATED: superseded by entity_owners join table for business entities.
  // Kept nullable on the row for back-compat with reads that haven't migrated yet.
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
  // Trust-only. Every supported trust sub-type is irrevocable, so this is
  // always true for valid trusts (API-enforced via deriveIsIrrevocable). The
  // deprecated `revocable` enum value is a DB-only orphan and never set here.
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
  taxTreatment: entityTaxTreatmentEnum("tax_treatment")
    .notNull()
    .default("ordinary"),
  // Business-type only. % of net income distributed to entity_owners each year.
  // Null for trusts (which use distributionMode + distributionPercent above).
  distributionPolicyPercent: decimal("distribution_policy_percent", {
    precision: 5,
    scale: 4,
  }),
  // 'annual' = engine reads income/expense rows (annualAmount + growthRate) and
  // distributionPolicyPercent. 'schedule' = engine reads entity_flow_overrides
  // exclusively; empty cells resolve to 0 (no fall-through to base+growth).
  flowMode: entityFlowModeEnum("flow_mode").notNull().default("annual"),
  // Annual compound growth rate applied to the standalone equity value
  // (entities.value). Null defaults to 0% (no growth, today's behavior).
  // Business-entity only — trusts/foundations track value via accounts.
  valueGrowthRate: decimal("value_growth_rate", { precision: 7, scale: 4 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // Engine load path filters entities by client_id (entities are client- not
  // scenario-scoped) (audit F7).
  clientIdx: index("entities_client_idx").on(t.clientId),
}));

// Ownership of a business entity. Mirrors account_owners' polymorphic shape:
// an owner is exactly one of family_member_id (individual) or owner_entity_id
// (another entity, e.g. a trust holding business units). Trust grantor /
// beneficiary structure is still captured separately via the grantor column
// on entities and beneficiary_designations.
export const entityOwners = pgTable(
  "entity_owners",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    // Exactly one of familyMemberId / ownerEntityId must be non-null (enforced by CHECK).
    familyMemberId: uuid("family_member_id").references(() => familyMembers.id, {
      onDelete: "cascade",
    }),
    ownerEntityId: uuid("owner_entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    percent: decimal("percent", { precision: 6, scale: 4 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    exactlyOneOwner: check(
      "entity_owners_one_owner",
      sql`(${t.familyMemberId} IS NOT NULL)::int
        + (${t.ownerEntityId} IS NOT NULL)::int = 1`,
    ),
    uniqOwner: unique("entity_owners_uniq")
      .on(t.entityId, t.familyMemberId, t.ownerEntityId)
      .nullsNotDistinct(),
  }),
);

export const trustSplitInterestDetails = pgTable(
  "trust_split_interest_details",
  {
    entityId: uuid("entity_id")
      .primaryKey()
      .references(() => entities.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    inceptionYear: integer("inception_year").notNull(),
    inceptionValue: decimal("inception_value", { precision: 15, scale: 2 }).notNull(),
    payoutType: trustPayoutTypeEnum("payout_type").notNull(),
    payoutPercent: decimal("payout_percent", { precision: 7, scale: 4 }),
    payoutAmount: decimal("payout_amount", { precision: 15, scale: 2 }),
    irc7520Rate: decimal("irc_7520_rate", { precision: 6, scale: 4 }).notNull(),
    termType: trustTermTypeEnum("term_type").notNull(),
    termYears: integer("term_years"),
    measuringLife1Id: uuid("measuring_life_1_id").references(() => familyMembers.id, {
      onDelete: "restrict",
    }),
    measuringLife2Id: uuid("measuring_life_2_id").references(() => familyMembers.id, {
      onDelete: "restrict",
    }),
    charityId: uuid("charity_id")
      .notNull()
      .references(() => externalBeneficiaries.id, { onDelete: "restrict" }),
    originalIncomeInterest: decimal("original_income_interest", {
      precision: 15,
      scale: 2,
    }).notNull(),
    originalRemainderInterest: decimal("original_remainder_interest", {
      precision: 15,
      scale: 2,
    }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("trust_split_interest_client_idx").on(t.clientId),
    check(
      "split_interest_unitrust_payout",
      sql`(${t.payoutType} != 'unitrust') OR (${t.payoutPercent} IS NOT NULL AND ${t.payoutAmount} IS NULL)`,
    ),
    check(
      "split_interest_annuity_payout",
      sql`(${t.payoutType} != 'annuity') OR (${t.payoutAmount} IS NOT NULL AND ${t.payoutPercent} IS NULL)`,
    ),
    check(
      "split_interest_term_years_required",
      sql`(${t.termType} NOT IN ('years', 'shorter_of_years_or_life')) OR (${t.termYears} IS NOT NULL)`,
    ),
    check(
      "split_interest_measuring_life_required",
      sql`(${t.termType} NOT IN ('single_life', 'joint_life', 'shorter_of_years_or_life')) OR (${t.measuringLife1Id} IS NOT NULL)`,
    ),
    check(
      "split_interest_joint_life_requires_two",
      sql`(${t.termType} != 'joint_life') OR (${t.measuringLife2Id} IS NOT NULL)`,
    ),
  ],
);

export const entityFlowOverrides = pgTable(
  "entity_flow_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    // Null = base-plan override (no scenario active). Non-null = override scoped
    // to a specific scenario. Unique index uses NULLS NOT DISTINCT so the base
    // case still gets one row per (entity, year).
    scenarioId: uuid("scenario_id").references(() => scenarios.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    // Sparse cells — null = use base+growth (or entity base for distribution_percent).
    incomeAmount: decimal("income_amount", { precision: 15, scale: 2 }),
    expenseAmount: decimal("expense_amount", { precision: 15, scale: 2 }),
    distributionPercent: decimal("distribution_percent", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueEntityScenarioYear: unique("entity_flow_overrides_entity_scenario_year_uniq")
      .on(t.entityId, t.scenarioId, t.year)
      .nullsNotDistinct(),
    entityScenarioIdx: index("entity_flow_overrides_entity_scenario_idx").on(
      t.entityId,
      t.scenarioId,
    ),
  }),
);

// Parallel of entity_flow_overrides for business-as-asset accounts
// (accounts.category = 'business' AND parent_account_id IS NULL). When
// accounts.flow_mode = 'schedule', the engine reads these rows exclusively
// for the business's net-income computation; missing cells resolve to 0
// (income_amount / expense_amount) or to account.distribution_policy_percent
// (distribution_percent). API-enforced: account must be a top-level business.
export const accountFlowOverrides = pgTable(
  "account_flow_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Null = base-plan override (no scenario active). Same NULLS NOT DISTINCT
    // semantics as entity_flow_overrides.
    scenarioId: uuid("scenario_id").references(() => scenarios.id, { onDelete: "cascade" }),
    year: integer("year").notNull(),
    incomeAmount: decimal("income_amount", { precision: 15, scale: 2 }),
    expenseAmount: decimal("expense_amount", { precision: 15, scale: 2 }),
    distributionPercent: decimal("distribution_percent", { precision: 5, scale: 4 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    uniqueAccountScenarioYear: unique("account_flow_overrides_account_scenario_year_uniq")
      .on(t.accountId, t.scenarioId, t.year)
      .nullsNotDistinct(),
    accountScenarioIdx: index("account_flow_overrides_account_scenario_idx").on(
      t.accountId,
      t.scenarioId,
    ),
  }),
);

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
  domesticPartner: boolean("domestic_partner").notNull().default(false),
  inheritanceClassOverride: jsonb("inheritance_class_override")
    .$type<Partial<Record<"PA" | "NJ" | "KY" | "NE" | "MD", "A" | "B" | "C" | "D">>>()
    .notNull()
    .default({}),
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
    // How a remainder beneficiary receives their share: held in a continuing
    // trust ('in_trust') or distributed free and clear ('outright'). Null for
    // non-remainder tiers — the distinction is only meaningful for the corpus.
    distributionForm: distributionFormEnum("distribution_form"),
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
    businessEntityId: uuid("business_entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    percent: decimal("percent", { precision: 6, scale: 4 }),
    parentGiftId: uuid("parent_gift_id"),
    useCrummeyPowers: boolean("use_crummey_powers").notNull().default(false),
    eventKind: giftEventKindEnum("event_kind").notNull().default("outright"),
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
        (${t.amount} IS NOT NULL AND ${t.accountId} IS NULL AND ${t.liabilityId} IS NULL AND ${t.percent} IS NULL AND ${t.businessEntityId} IS NULL)
        OR
        ((${t.accountId} IS NOT NULL OR ${t.liabilityId} IS NOT NULL)
         AND ${t.percent} IS NOT NULL
         AND NOT (${t.accountId} IS NOT NULL AND ${t.liabilityId} IS NOT NULL)
         AND ${t.businessEntityId} IS NULL)
        OR
        (${t.businessEntityId} IS NOT NULL AND ${t.percent} IS NOT NULL AND ${t.accountId} IS NULL AND ${t.liabilityId} IS NULL AND ${t.recipientEntityId} IS NOT NULL)
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
}, (t) => [
  unique("asset_classes_firm_id_name_unique").on(t.firmId, t.name),
  uniqueIndex("asset_classes_firm_slug_uniq").on(t.firmId, t.slug).where(sql`${t.slug} IS NOT NULL`),
]);

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

// Named CMA sets (Historical / Projected / Custom). Exactly three per firm; one
// is active. The active set's numbers are mirrored onto asset_classes columns so
// all existing readers are unchanged — cma_set_values is the durable store.
export const cmaSets = pgTable(
  "cma_sets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id").notNull(),
    key: varchar("key", { length: 16 }).notNull(), // 'historical' | 'projected' | 'custom'
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("cma_sets_firm_key_unique").on(t.firmId, t.key),
    uniqueIndex("cma_sets_one_active_per_firm")
      .on(t.firmId)
      .where(sql`${t.isActive}`),
  ],
);

// Per-set return/vol numbers, one row per (set, asset class). The three numeric
// fields here are the only thing that varies between sets; identity, tax
// composition, and correlations are shared on asset_classes.
export const cmaSetValues = pgTable(
  "cma_set_values",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    cmaSetId: uuid("cma_set_id")
      .notNull()
      .references(() => cmaSets.id, { onDelete: "cascade" }),
    assetClassId: uuid("asset_class_id")
      .notNull()
      .references(() => assetClasses.id, { onDelete: "cascade" }),
    geometricReturn: decimal("geometric_return", { precision: 7, scale: 4 }).notNull(),
    arithmeticMean: decimal("arithmetic_mean", { precision: 7, scale: 4 }).notNull(),
    volatility: decimal("volatility", { precision: 7, scale: 4 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("cma_set_values_set_class_uniq").on(t.cmaSetId, t.assetClassId)],
);

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

// Global, firm-agnostic security reference. Keyed by (identifier_type,
// identifier). Populated by the classification layer (bulk pull + on-demand).
export const securities = pgTable(
  "securities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifierType: varchar("identifier_type", { length: 16 }).notNull(), // ticker | cusip | figi
    identifier: text("identifier").notNull(),
    figi: text("figi"),
    name: text("name"),
    securityType: varchar("security_type", { length: 16 }).notNull().default("other"), // etf|mutual_fund|stock|bond|cash|other
    classifierSource: varchar("classifier_source", { length: 16 }).notNull().default("eodhd"), // eodhd|seed|manual
    classifierVersion: integer("classifier_version").notNull().default(1),
    rawPayload: jsonb("raw_payload"),
    classifiedAt: timestamp("classified_at").defaultNow().notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("securities_identifier_uniq").on(t.identifierType, t.identifier)]
);

// A security's blend across canonical asset-class slugs. Weights sum ≈ 1.
export const securityAssetClassWeights = pgTable(
  "security_asset_class_weights",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    securityId: uuid("security_id")
      .notNull()
      .references(() => securities.id, { onDelete: "cascade" }),
    // Canonical slug (see asset-class-slugs.ts). Intentionally NOT a FK to
    // asset_classes.slug: securities are global/firm-agnostic while asset_classes
    // is firm-scoped — a later phase resolves slug → firm assetClassId per firm.
    assetClassSlug: varchar("asset_class_slug", { length: 50 }).notNull(),
    weight: decimal("weight", { precision: 5, scale: 4 }).notNull(),
  },
  (t) => [uniqueIndex("security_acw_uniq").on(t.securityId, t.assetClassSlug)]
);

// Firm-level CMA settings. One row per firm. Holds the risk-free rate used for
// Sharpe/Sortino on Fund Portfolios.
export const cmaSettings = pgTable("cma_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  riskFreeRate: decimal("risk_free_rate", { precision: 6, scale: 4 }).notNull().default("0.04"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("cma_settings_firm_uniq").on(t.firmId)]);

// Ticker-based portfolios — peer to model_portfolios, but built from funds.
export const tickerPortfolios = pgTable("ticker_portfolios", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique("ticker_portfolios_firm_id_name_unique").on(t.firmId, t.name)]);

export const tickerPortfolioHoldings = pgTable("ticker_portfolio_holdings", {
  id: uuid("id").defaultRandom().primaryKey(),
  tickerPortfolioId: uuid("ticker_portfolio_id")
    .notNull()
    .references(() => tickerPortfolios.id, { onDelete: "cascade" }),
  securityId: uuid("security_id").references(() => securities.id, { onDelete: "set null" }),
  displayTicker: text("display_ticker").notNull(),
  weight: decimal("weight", { precision: 5, scale: 4 }).notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [uniqueIndex("ticker_portfolio_holdings_uniq").on(t.tickerPortfolioId, t.displayTicker)]);

// Monthly EODHD adjusted-close cache (append-only). Keyed by (security, month).
export const securityPriceHistory = pgTable("security_price_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  securityId: uuid("security_id")
    .notNull()
    .references(() => securities.id, { onDelete: "cascade" }),
  month: date("month").notNull(), // month-end date "YYYY-MM-01" canonical
  adjustedClose: decimal("adjusted_close", { precision: 18, scale: 6 }).notNull(),
}, (t) => [uniqueIndex("security_price_history_uniq").on(t.securityId, t.month)]);

// Cached computed metrics for a ticker portfolio. Recomputed on edit / monthly.
export const tickerPortfolioStats = pgTable("ticker_portfolio_stats", {
  id: uuid("id").defaultRandom().primaryKey(),
  tickerPortfolioId: uuid("ticker_portfolio_id")
    .notNull()
    .references(() => tickerPortfolios.id, { onDelete: "cascade" }),
  windowStart: date("window_start"),
  windowEnd: date("window_end"),
  nMonths: integer("n_months").notNull().default(0),
  annArithMean: decimal("ann_arith_mean", { precision: 9, scale: 6 }),
  annGeoReturn: decimal("ann_geo_return", { precision: 9, scale: 6 }),
  annVolatility: decimal("ann_volatility", { precision: 9, scale: 6 }),
  downsideDeviation: decimal("downside_deviation", { precision: 9, scale: 6 }),
  sharpe: decimal("sharpe", { precision: 9, scale: 6 }),
  sortino: decimal("sortino", { precision: 9, scale: 6 }),
  maxDrawdown: decimal("max_drawdown", { precision: 9, scale: 6 }),
  limitingTicker: text("limiting_ticker"),
  computedAt: timestamp("computed_at").defaultNow().notNull(),
}, (t) => [uniqueIndex("ticker_portfolio_stats_uniq").on(t.tickerPortfolioId)]);

// Individual positions inside an investment account. Org-scoped via the
// account → client → firm chain. When an account has holdings and its
// growthSource is "holdings", these are authoritative for value + basis and
// roll up (value-weighted) into the account's asset-class blend.
export const accountHoldings = pgTable(
  "account_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    // Nullable: a fully-manual holding (override-only, no classified security).
    securityId: uuid("security_id").references(() => securities.id, {
      onDelete: "set null",
    }),
    displayTicker: text("display_ticker"),
    displayName: text("display_name"),
    shares: decimal("shares", { precision: 18, scale: 6 }).notNull().default("0"),
    price: decimal("price", { precision: 15, scale: 4 }).notNull().default("0"),
    priceAsOf: date("price_as_of"),
    costBasis: decimal("cost_basis", { precision: 15, scale: 2 }).notNull().default("0"),
    // Authoritative market value when set (statement-derived for untickered/manual
    // holdings — bonds quote price per $100 par, so shares×price is NOT the value).
    // NULL for tickered holdings, which derive shares×price from the live-refreshed price.
    // (precision 18 — headroom for large bond notional values.)
    marketValue: decimal("market_value", { precision: 18, scale: 2 }),
    sortOrder: integer("sort_order").notNull().default(0),
    notes: text("notes"),
    // Provenance: 'plaid' rows are replaced wholesale on each Plaid sync; manual
    // rows (advisor-entered) are never touched by the sync.
    source: holdingSourceEnum("source").notNull().default("manual"),
    // Plaid-side security_id for this position (null for manual). Diagnostic /
    // future per-position matching; the sync currently replaces all plaid rows.
    plaidSecurityId: text("plaid_security_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [index("account_holdings_account_idx").on(t.accountId)]
);

// Per-holding manual asset-class blend. When present (≥1 row), WINS permanently
// over the security's derived slug blend for that holding. Firm assetClassId
// (not a canonical slug) — overrides are firm-specific by construction.
export const holdingAssetClassOverrides = pgTable(
  "holding_asset_class_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    holdingId: uuid("holding_id")
      .notNull()
      .references(() => accountHoldings.id, { onDelete: "cascade" }),
    assetClassId: uuid("asset_class_id")
      .notNull()
      .references(() => assetClasses.id, { onDelete: "cascade" }),
    weight: decimal("weight", { precision: 5, scale: 4 }).notNull(),
  },
  (t) => [uniqueIndex("holding_acw_override_uniq").on(t.holdingId, t.assetClassId)]
);

// Daily point-in-time value of an investment account, used by the portal
// Investments trend chart. Value = Σ holdingMarketValue (NOT accounts.value,
// which the daily price cron does not update). One row per (account, day).
export const accountValueSnapshots = pgTable(
  "account_value_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    asOfDate: date("as_of_date").notNull(),
    value: decimal("value", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("account_value_snapshots_acct_date_uniq").on(t.accountId, t.asOfDate),
    index("account_value_snapshots_acct_idx").on(t.accountId),
  ],
);

// Audit row for one daily holding-price refresh cron run (see
// /api/cron/refresh-holding-prices). Mirrors the reconciliationRuns pattern.
export const holdingPriceRefreshRuns = pgTable("holding_price_refresh_runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  status: varchar("status", { length: 16 }).notNull().default("running"), // running|ok|partial|error
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  uniqueTickers: integer("unique_tickers").notNull().default(0),
  tickersPriced: integer("tickers_priced").notNull().default(0),
  tickersMissing: integer("tickers_missing").notNull().default(0),
  holdingsUpdated: integer("holdings_updated").notNull().default(0),
  accountsResynced: integer("accounts_resynced").notNull().default(0),
  failures: jsonb("failures"), // [{ stage, ref, message }]
});

// A revocable living trust is NOT an entity in this app — it is a lightweight,
// named probate-skip tag. Assets keep their existing owner; tagging one only
// (a) excludes it from the probate total and (b) shows the trust's name as a
// badge on the estate-tax + balance-sheet reports. Client-scoped (mirrors
// entities); membership lives on accounts.revocable_trust_id (scenario-scoped).
export const revocableTrusts = pgTable("revocable_trusts", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  clientIdx: index("revocable_trusts_client_idx").on(t.clientId),
}));

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
  accountNumberLast4: text("account_number_last4"),
  custodian: text("custodian"),
  insuredPerson: insuredPersonEnum("insured_person"),
  value: decimal("value", { precision: 15, scale: 2 }).notNull().default("0"),
  basis: decimal("basis", { precision: 15, scale: 2 }).notNull().default("0"),
  // For 401k / 403b accounts only: the Roth-designated portion of `value`.
  // Grows at the account's growth rate alongside the rest of the balance and
  // comes out tax-free on withdrawal / Roth conversion (pro-rata). Defaults
  // to 0 — a plain pre-tax 401(k). Ignored for non-401k/403b subtypes.
  rothValue: decimal("roth_value", { precision: 15, scale: 2 }).notNull().default("0"),
  // HSA coverage tier (self-only vs family). NULL for every non-HSA account.
  // Drives the contribution cap (self vs family limit) in the engine.
  hsaCoverage: hsaCoverageEnum("hsa_coverage"),
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
  // Optional future-activation year: the account is absent from the projection
  // (no balance, growth, contributions, premiums, or death benefit) until this
  // year, then appears at `value`. Null ⇒ active from plan start. `*_ref` is an
  // optional milestone anchor mirroring incomes' startYearRef.
  activationYear: integer("activation_year"),
  activationYearRef: yearRefEnum("activation_year_ref"),
  // Exactly one account per (client, scenario) has this flag set. Household income is
  // paid into this account and expenses, taxes, and savings are drawn from it; when it
  // goes negative the engine pulls from the withdrawal strategy to top it up.
  isDefaultChecking: boolean("is_default_checking").notNull().default(false),
  growthSource: growthSourceEnum("growth_source").notNull().default("default"),
  // When true (default) and the account has ≥1 holding, the holdings drive the
  // account's value/basis and its asset mix (growthSource is forced to
  // asset_mix and account_asset_allocations is auto-seeded by
  // syncAccountFromHoldings). Set false to record holdings without driving the
  // account (the advisor's chosen growthSource / mix / value apply instead).
  deriveFromHoldings: boolean("derive_from_holdings").notNull().default(true),
  modelPortfolioId: uuid("model_portfolio_id").references(() => modelPortfolios.id, {
    onDelete: "set null",
  }),
  tickerPortfolioId: uuid("ticker_portfolio_id").references(() => tickerPortfolios.id, {
    onDelete: "set null",
  }),
  turnoverPct: decimal("turnover_pct", { precision: 5, scale: 4 }).notNull().default("0"),
  overridePctOi: decimal("override_pct_oi", { precision: 5, scale: 4 }),
  overridePctLtCg: decimal("override_pct_lt_cg", { precision: 5, scale: 4 }),
  overridePctQdiv: decimal("override_pct_qdiv", { precision: 5, scale: 4 }),
  overridePctTaxExempt: decimal("override_pct_tax_exempt", { precision: 5, scale: 4 }),
  annualPropertyTax: decimal("annual_property_tax", { precision: 15, scale: 2 }).notNull().default("0"),
  propertyTaxGrowthRate: decimal("property_tax_growth_rate", { precision: 5, scale: 4 }).notNull().default("0.03"),
  // Source for `propertyTaxGrowthRate`. When "inflation", the engine
  // substitutes the plan's resolved inflation rate at projection time;
  // the rate column is then a fallback / display value only.
  propertyTaxGrowthSource: itemGrowthSourceEnum("property_tax_growth_source").notNull().default("custom"),
  titlingType: titlingTypeEnum("titling_type").notNull().default("jtwros"),
  source: sourceEnum("source").notNull().default("manual"),
  // Business-only columns. Null/zero for non-business accounts. Apply only
  // when category = 'business'.
  businessType: accountBusinessTypeEnum("business_type"),
  distributionPolicyPercent: decimal("distribution_policy_percent", {
    precision: 5,
    scale: 4,
  }),
  flowMode: entityFlowModeEnum("flow_mode").notNull().default("annual"),
  businessTaxTreatment: entityTaxTreatmentEnum("business_tax_treatment"),
  // Parent business account: lets a sub-asset (operating checking, real estate
  // owned inside the LLC, etc.) hang off its parent business. Null for top-level
  // accounts. Single-parent — splitting one sub-account across two parent
  // businesses is not supported.
  parentAccountId: uuid("parent_account_id").references((): AnyPgColumn => accounts.id, {
    onDelete: "set null",
  }),
  // Plaid linked-item this account was imported from (null = manual). FK with
  // ON DELETE SET NULL so unlinking an institution doesn't delete the accounts.
  // Dormant on `main` (Plaid linking lives on a feature branch) but already
  // present on the live dev DB — declared here to prevent drizzle drift (F14).
  plaidItemId: uuid("plaid_item_id").references(() => plaidItems.id, {
    onDelete: "set null",
  }),
  // Plaid-side account identifier within the linked item (null = manual).
  plaidAccountId: text("plaid_account_id"),
  notes: text("notes"),
  // Revocable-trust membership tag. Null = not in a revocable trust. ON DELETE
  // SET NULL so deleting a trust just untags its accounts (no asset loss).
  revocableTrustId: uuid("revocable_trust_id").references(
    (): AnyPgColumn => revocableTrusts.id,
    { onDelete: "set null" },
  ),
  // ── 529 / education-savings columns. Null for every other category. ──
  // Grantor: exactly one of the two may be set. A household family member
  // (grantorFamilyMemberId) funds contributions from household cash flow and
  // earns the state contribution deduction; a named outside person
  // (grantorName, e.g. a grandparent) funds the account without touching
  // household cash and earns no household deduction.
  grantorFamilyMemberId: uuid("grantor_family_member_id").references(
    () => familyMembers.id,
    { onDelete: "set null" },
  ),
  grantorName: text("grantor_name"),
  // Designated beneficiary: exactly one of the two must be set for
  // education_savings accounts. The account is attributed to (displayed
  // under) this person and is OUT of the household estate. No
  // account_owners rows are written for education_savings accounts.
  beneficiaryFamilyMemberId: uuid("beneficiary_family_member_id").references(
    () => familyMembers.id,
    { onDelete: "set null" },
  ),
  beneficiaryName: text("beneficiary_name"),
  // SECURE 2.0 529→Roth rollover. When enabled, the engine drips leftover
  // balance into rothRolloverAccountId (a household Roth IRA) starting at
  // rothRolloverStartYear, capped at the annual IRA limit per year and
  // $35,000 lifetime per beneficiary. Null destination = funds exit the
  // plan to the beneficiary (out of household scope).
  rothRolloverEnabled: boolean("roth_rollover_enabled").notNull().default(false),
  rothRolloverStartYear: integer("roth_rollover_start_year"),
  rothRolloverAccountId: uuid("roth_rollover_account_id").references(
    (): AnyPgColumn => accounts.id,
    { onDelete: "set null" },
  ),
  // Orion integration: provider identifier + external account ID for accounts
  // synced from Orion. Null for manually-created accounts.
  externalProvider: text("external_provider"),
  externalId: text("external_id"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // Engine load path filters every projection by (client_id, scenario_id);
  // accounts is the hottest table and was previously full-scanned (audit F7).
  clientScenarioIdx: index("accounts_client_scenario_idx").on(t.clientId, t.scenarioId),
  // Prevents duplicate external accounts per client+provider+externalId.
  externalAccountUnique: uniqueIndex("accounts_client_external_uq")
    .on(t.clientId, t.externalProvider, t.externalId)
    .where(sql`${t.externalId} IS NOT NULL`),
  // Plaid: one Foundry row per (item, plaid account). Partial — manual rows have null plaid_account_id.
  plaidAccountUnique: uniqueIndex("accounts_plaid_account_uniq")
    .on(t.plaidItemId, t.plaidAccountId)
    .where(sql`${t.plaidAccountId} IS NOT NULL`),
}));

// Plaid linked-institution items. Dormant on `main` — the client-portal Plaid
// linking flow lives on a feature branch — but the table + the
// accounts.plaid_item_id FK (ON DELETE SET NULL) already exist on the live dev
// DB. Re-declared here to match that live schema EXACTLY so a `drizzle-kit`
// introspection / push won't treat the table as drift and drop it, and so the
// in-flight Plaid branch doesn't have to re-create it (audit F14). Columns,
// nullability, the clients-cascade FK and unique(plaid_item_id) all mirror
// br-curly-cell-amew7wcr. Timestamps are tz-naive `timestamp` to match live.
export const plaidItems = pgTable("plaid_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  // The Plaid-side item identifier (a Plaid string handle, not a DB FK).
  plaidItemId: text("plaid_item_id").notNull().unique(),
  accessToken: text("access_token").notNull(),
  institutionId: text("institution_id"),
  institutionName: text("institution_name"),
  lastRefreshedAt: timestamp("last_refreshed_at"),
  lastRefreshError: text("last_refresh_error"),
  // Incremental /transactions/sync cursor. NULL = never synced (first sync
  // passes cursor undefined + options.days_requested).
  transactionsCursor: text("transactions_cursor"),
  // Stamped by the ITEM:NEW_ACCOUNTS_AVAILABLE webhook; cleared when the user
  // dismisses the prompt or completes an account-selection Link flow.
  newAccountsAvailableAt: timestamp("new_accounts_available_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  clientIdx: index("plaid_items_client_idx").on(t.clientId),
}));

// Delivery log for POST /api/webhooks/plaid. Plaid sends no event id, so
// there is no unique-constraint dedup (unlike billing_events) — handlers are
// idempotent instead. plaid_item_id is Plaid's string handle, NOT a DB FK,
// so rows survive item unlink.
export const plaidWebhookEvents = pgTable(
  "plaid_webhook_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    plaidItemId: text("plaid_item_id"),
    webhookType: text("webhook_type").notNull(),
    webhookCode: text("webhook_code").notNull(),
    environment: text("environment"),
    // 'ok' | 'ignored' | 'error' — null while processing.
    result: text("result"),
    errorMessage: text("error_message"),
    processingDurationMs: integer("processing_duration_ms"),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    itemIdx: index("plaid_webhook_events_item_idx").on(t.plaidItemId),
  }),
);

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
    externalBeneficiaryId: uuid("external_beneficiary_id").references(
      () => externalBeneficiaries.id,
      { onDelete: "cascade" },
    ),
    percent: decimal("percent", { precision: 6, scale: 4 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    exactlyOneOwner: check(
      "account_owners_one_owner",
      sql`(${t.familyMemberId} IS NOT NULL)::int
        + (${t.entityId} IS NOT NULL)::int
        + (${t.externalBeneficiaryId} IS NOT NULL)::int = 1`,
    ),
    uniqOwner: unique("account_owners_uniq")
      .on(t.accountId, t.familyMemberId, t.entityId, t.externalBeneficiaryId)
      .nullsNotDistinct(),
  }),
);

export const accountGroups = pgTable(
  "account_groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    clientIdx: index("account_groups_client_idx").on(t.clientId),
    nameUniq: uniqueIndex("account_groups_client_name_unique").on(
      t.clientId,
      sql`LOWER(${t.name})`,
    ),
  }),
);

export const accountGroupMembers = pgTable(
  "account_group_members",
  {
    accountGroupId: uuid("account_group_id")
      .notNull()
      .references(() => accountGroups.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.accountGroupId, t.accountId] }),
    accountIdx: index("account_group_members_account_idx").on(t.accountId),
  }),
);

export const lifeInsurancePolicies = pgTable("life_insurance_policies", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  carrier: text("carrier"),
  policyNumberLast4: text("policy_number_last4"),
  faceValue: decimal("face_value", { precision: 15, scale: 2 }).notNull().default("0"),
  costBasis: decimal("cost_basis", { precision: 15, scale: 2 }).notNull().default("0"),
  premiumAmount: decimal("premium_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  premiumYears: integer("premium_years"),
  premiumPayer: premiumPayerEnum("premium_payer").notNull().default("owner"),
  policyType: policyTypeEnum("policy_type").notNull(),
  termIssueYear: integer("term_issue_year"),
  termLengthYears: integer("term_length_years"),
  endsAtInsuredRetirement: boolean("ends_at_insured_retirement").notNull().default(false),
  cashValueGrowthMode: cashValueGrowthModeEnum("cash_value_growth_mode")
    .notNull()
    .default("basic"),
  premiumScheduleMode: scheduleModeEnum("premium_schedule_mode")
    .notNull()
    .default("off"),
  deathBenefitScheduleMode: scheduleModeEnum("death_benefit_schedule_mode")
    .notNull()
    .default("off"),
  incomeScheduleMode: scheduleModeEnum("income_schedule_mode")
    .notNull()
    .default("off"),
  postPayoutGrowthRate: decimal("post_payout_growth_rate", { precision: 5, scale: 4 })
    .notNull()
    .default("0.06"),
  // When set, the standalone-mode payout transforms into a taxable account
  // driven by this model portfolio's CMA — both growth rate and tax
  // realization mix flow from the portfolio.
  postPayoutModelPortfolioId: uuid("post_payout_model_portfolio_id").references(
    () => modelPortfolios.id,
    { onDelete: "set null" },
  ),
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
    cashValue: decimal("cash_value", { precision: 15, scale: 2 }),
    premiumAmount: decimal("premium_amount", { precision: 15, scale: 2 }),
    income: decimal("income", { precision: 15, scale: 2 }),
    deathBenefit: decimal("death_benefit", { precision: 15, scale: 2 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    policyYearUnique: unique().on(table.policyId, table.year),
  }),
);

// ── Stock options (equity compensation) ──────────────────────────────────
// 1:1 extension on a stock_options account. Mirrors lifeInsurancePolicies.
export const stockOptionAccounts = pgTable("stock_option_accounts", {
  accountId: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id, { onDelete: "cascade" }),
  ticker: text("ticker"),
  isPublic: boolean("is_public").notNull().default(false),
  // Current FMV per share. Public: snapshot of the pulled quote. Private: manual 409A FMV.
  pricePerShare: decimal("price_per_share", { precision: 15, scale: 4 }).notNull().default("0"),
  // Where acquired (vested/exercised-and-held) shares land. Null + autoCreate → engine
  // auto-creates a per-ticker brokerage account on first acquisition.
  destinationAccountId: uuid("destination_account_id").references((): AnyPgColumn => accounts.id, {
    onDelete: "set null",
  }),
  autoCreateDestination: boolean("auto_create_destination").notNull().default(true),
  sellToCover: boolean("sell_to_cover").notNull().default(true),
  withholdingRate: decimal("withholding_rate", { precision: 5, scale: 4 }).notNull().default("0.22"),
  // Account-level DEFAULT strategy (grant/tranche may override; null on those = inherit).
  defaultExerciseTiming: equityExerciseTimingEnum("default_exercise_timing").notNull().default("at_vest"),
  defaultExerciseYear: integer("default_exercise_year"),
  defaultSellTiming: equitySellTimingEnum("default_sell_timing").notNull().default("hold"),
  defaultSellYear: integer("default_sell_year"),
  defaultSellPercentPerYear: decimal("default_sell_percent_per_year", { precision: 5, scale: 4 }),
  defaultSellStartYear: integer("default_sell_start_year"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const stockOptionGrants = pgTable("stock_option_grants", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  grantNumber: text("grant_number"),
  grantType: grantTypeEnum("grant_type").notNull(),
  grantDate: date("grant_date").notNull(),
  sharesGranted: decimal("shares_granted", { precision: 18, scale: 6 }).notNull().default("0"),
  has83bElection: boolean("has_83b_election").notNull().default(false),
  // FMV/share at grant — required when has83bElection (the income base). Null otherwise.
  fmvAtGrant: decimal("fmv_at_grant", { precision: 15, scale: 4 }),
  // NQSO/ISO only. strikePrice OR strikeDiscountPct (a % off FMV in the exercise year).
  strikePrice: decimal("strike_price", { precision: 15, scale: 4 }),
  strikeDiscountPct: decimal("strike_discount_pct", { precision: 5, scale: 4 }),
  expirationDate: date("expiration_date"),
  // Grant-level strategy override (null = inherit account default).
  exerciseTiming: equityExerciseTimingEnum("exercise_timing"),
  exerciseYear: integer("exercise_year"),
  sellTiming: equitySellTimingEnum("sell_timing"),
  sellYear: integer("sell_year"),
  sellPercentPerYear: decimal("sell_percent_per_year", { precision: 5, scale: 4 }),
  sellStartYear: integer("sell_start_year"),
  sortOrder: integer("sort_order").notNull().default(0),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const stockOptionVestTranches = pgTable("stock_option_vest_tranches", {
  id: uuid("id").defaultRandom().primaryKey(),
  grantId: uuid("grant_id")
    .notNull()
    .references(() => stockOptionGrants.id, { onDelete: "cascade" }),
  vestDate: date("vest_date").notNull(),
  shares: decimal("shares", { precision: 18, scale: 6 }).notNull().default("0"),
  // Actuals (already happened, entered by the advisor).
  sharesExercised: decimal("shares_exercised", { precision: 18, scale: 6 }).notNull().default("0"),
  sharesSold: decimal("shares_sold", { precision: 18, scale: 6 }).notNull().default("0"),
  // Tranche-level strategy override (null = inherit grant/account).
  exerciseTiming: equityExerciseTimingEnum("exercise_timing"),
  exerciseYear: integer("exercise_year"),
  sellTiming: equitySellTimingEnum("sell_timing"),
  sellYear: integer("sell_year"),
  sellPercentPerYear: decimal("sell_percent_per_year", { precision: 5, scale: 4 }),
  sellStartYear: integer("sell_start_year"),
  sortOrder: integer("sort_order").notNull().default(0),
});

// Escape hatch for the `manual` exercise/sell timing: explicit dated events.
export const stockOptionPlannedEvents = pgTable("stock_option_planned_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  grantId: uuid("grant_id")
    .notNull()
    .references(() => stockOptionGrants.id, { onDelete: "cascade" }),
  trancheId: uuid("tranche_id").references(() => stockOptionVestTranches.id, { onDelete: "set null" }),
  year: integer("year").notNull(),
  action: equityPlannedActionEnum("action").notNull(),
  shares: decimal("shares", { precision: 18, scale: 6 }),
  pct: decimal("pct", { precision: 5, scale: 4 }),
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
  // Fraction (0..1) of a deferred income the surviving spouse continues to
  // receive after the owner's death. Null/0 = income simply ends at owner death.
  survivorshipPct: decimal("survivorship_pct", { precision: 5, scale: 4 }),
  // §2056(b)(7)(C) QTIP elect-out for a survivor annuity. Null/false = deemed
  // QTIP (marital deduction offsets the §2039 inclusion at first death); true =
  // elect out (PV taxed in the first decedent's estate). Nullable, no default —
  // absence is treated as "not elected out" everywhere downstream.
  survivorAnnuityQtipElectOut: boolean("survivor_annuity_qtip_elect_out"),
  claimingAgeMonths: integer("claiming_age_months").default(0),
  claimingAgeMode: text("claiming_age_mode"),
  source: sourceEnum("source").notNull().default("manual"),
  // For income generated by a business asset (category = 'business'). Mutually
  // exclusive with ownerEntityId. The individual `owner` enum column always
  // resolves to a household member when both ownerEntityId and ownerAccountId
  // are null — exactness is enforced by the CHECK below.
  ownerAccountId: uuid("owner_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  // For an "Other" income that follows a real estate property. Mutually
  // exclusive with ownerEntityId / ownerAccountId (see incomes_one_owner).
  // When set, the engine derives the income's per-year owner from the
  // property's ownership (sale stops it, gift reroutes/scales it).
  linkedPropertyId: uuid("linked_property_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  exactlyOneOwner: check(
    "incomes_one_owner",
    sql`(${t.ownerEntityId} IS NOT NULL)::int + (${t.ownerAccountId} IS NOT NULL)::int + (${t.linkedPropertyId} IS NOT NULL)::int <= 1`,
  ),
  // Engine load path filters incomes by (client_id, scenario_id) (audit F7).
  clientScenarioIdx: index("incomes_client_scenario_idx").on(t.clientId, t.scenarioId),
}));

export const medicareCoverageTypeEnum = pgEnum("medicare_coverage_type", [
  "original",
  "advantage",
]);

export const medicareCoverage = pgTable("medicare_coverage", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  owner: ownerEnum("owner").notNull(),
  enrollmentYear: integer("enrollment_year"),                // null = use year person turns 65
  coverageType: medicareCoverageTypeEnum("coverage_type").notNull().default("original"),
  medigapMonthlyAt65: decimal("medigap_monthly_at65", { precision: 10, scale: 2 }),
  partDPlanMonthlyAt65: decimal("part_d_plan_monthly_at65", { precision: 10, scale: 2 }),
  priorYearMagi: decimal("prior_year_magi", { precision: 15, scale: 2 }),
  estimatePriorYearMagiFromProjection: boolean("estimate_prior_year_magi_from_projection")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  uniqueOwnerPerClient: unique("medicare_coverage_unique_owner").on(t.clientId, t.owner),
}));

export const taxReturnStatusEnum = pgEnum("tax_return_status", [
  "extracting",
  "needs_review",
  "ready",
  "failed",
]);

export const taxReturns = pgTable(
  "tax_returns",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    taxYear: integer("tax_year").notNull(),
    status: taxReturnStatusEnum("status").notNull().default("extracting"),
    // Immutable as-extracted snapshot (audit trail); null until extraction completes.
    extractedFacts: jsonb("extracted_facts"),
    // Editable working copy — advisor corrections land here.
    facts: jsonb("facts"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    vaultDocumentId: uuid("vault_document_id").references(
      () => crmHouseholdDocuments.id,
      { onDelete: "set null" },
    ),
    sourceFilename: text("source_filename"),
    promptVersion: text("prompt_version"),
    model: text("model"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    uniqueYearPerClient: unique("tax_returns_unique_client_year").on(
      t.clientId,
      t.taxYear,
    ),
  }),
);

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
  // Marks the seeded living-expense rows that are auto-created for every client
  // (current + retirement). Protected from deletion by API + UI.
  isDefault: boolean("is_default").notNull().default(false),
  // For expenses incurred by a business asset (category = 'business'). Mutually
  // exclusive with ownerEntityId. Enforced by the CHECK below.
  ownerAccountId: uuid("owner_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  // When set, engine zeros this expense from the named owner's Medicare enrollment
  // year onward. Used to mark pre-Medicare health-insurance expenses so they auto-end
  // when projected Medicare premiums kick in.
  endsAtMedicareEligibilityOwner: ownerEnum("ends_at_medicare_eligibility_owner"),
  // Education-goal fields (type === "education").
  // When true, any goal cost the dedicated accounts can't cover is paid from
  // household cash (normal withdrawal waterfall); when false, it's an unfunded
  // shortfall. Ignored for non-education rows.
  payShortfallOutOfPocket: boolean("pay_shortfall_out_of_pocket")
    .notNull()
    .default(false),
  // Optional free-text labels (no cost-lookup DB in v1).
  institutionState: text("institution_state"),
  institutionName: text("institution_name"),
  // "For": the student/beneficiary. Attribution/label only.
  forFamilyMemberId: uuid("for_family_member_id").references(
    () => familyMembers.id,
    { onDelete: "set null" },
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  exactlyOneOwner: check(
    "expenses_one_owner",
    sql`(${t.ownerEntityId} IS NOT NULL)::int + (${t.ownerAccountId} IS NOT NULL)::int <= 1`,
  ),
  // Engine load path filters expenses by (client_id, scenario_id) (audit F7).
  clientScenarioIdx: index("expenses_client_scenario_idx").on(t.clientId, t.scenarioId),
}));

export const expenseDedicatedAccounts = pgTable(
  "expense_dedicated_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("expense_dedicated_accounts_expense_sort_idx").on(t.expenseId, t.sortOrder),
    unique("expense_dedicated_accounts_uniq").on(t.expenseId, t.accountId),
  ],
);

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
  // was: .notNull().default("0")  — revolving credit has no scheduled payment
  monthlyPayment: decimal("monthly_payment", { precision: 15, scale: 2 }).default("0"),
  startYear: integer("start_year").notNull(),
  startMonth: integer("start_month").notNull().default(1),
  startYearRef: yearRefEnum("start_year_ref"),
  // was: integer("term_months").notNull() — revolving credit has no term
  termMonths: integer("term_months"),
  termUnit: text("term_unit").notNull().default("annual"),
  linkedPropertyId: uuid("linked_property_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  isInterestDeductible: boolean("is_interest_deductible").notNull().default(false),
  // Parent business account that owns this liability. Null for liabilities
  // owned only by individuals or trusts (via liability_owners).
  parentAccountId: uuid("parent_account_id").references(() => accounts.id, {
    onDelete: "set null",
  }),
  // Phase 2 (spending suite): debt-type discriminator. NULL = legacy amortizing
  // row (treated as a term loan by the engine). `credit_card` = held flat
  // (non-amortizing) by the projection engine — see engine/liability-kind.ts.
  liabilityType: liabilityTypeEnum("liability_type"),
  // Plaid Liabilities-product metadata (display-only; engine holds CC balances
  // flat). Nullable — only set for Plaid-synced revolving debt.
  minimumPayment: decimal("minimum_payment", { precision: 15, scale: 2 }),
  statementBalance: decimal("statement_balance", { precision: 15, scale: 2 }),
  aprPercentage: decimal("apr_percentage", { precision: 6, scale: 4 }),
  nextPaymentDueDate: date("next_payment_due_date"),
  // Plaid identity (mirrors accounts.plaidItemId / plaidAccountId). Lets a
  // Plaid debt be the stable natural key — prevents re-sync duplicates.
  plaidItemId: uuid("plaid_item_id").references(() => plaidItems.id, {
    onDelete: "set null",
  }),
  plaidAccountId: text("plaid_account_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  // Engine load path filters liabilities by (client_id, scenario_id) (audit F7).
  clientScenarioIdx: index("liabilities_client_scenario_idx").on(t.clientId, t.scenarioId),
  plaidAccountUnique: uniqueIndex("liabilities_plaid_account_uniq")
    .on(t.plaidItemId, t.plaidAccountId)
    .where(sql`${t.plaidAccountId} IS NOT NULL`),
}));

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

export const notesReceivable = pgTable("notes_receivable", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id")
    .notNull()
    .references(() => scenarios.id, { onDelete: "cascade" }),
  // toggle_group_id — nullable. When set, the loader filters this row
  // out when the named toggle group is off in the active ToggleState. Used
  // exclusively by the IDGT sale_to_trust route in v1; user-entered notes
  // are toggle_group_id IS NULL (always visible).
  toggleGroupId: uuid("toggle_group_id").references(
    () => scenarioToggleGroups.id,
    { onDelete: "set null" },
  ),
  name: text("name").notNull(),
  faceValue: decimal("face_value", { precision: 15, scale: 2 }).notNull(),
  basis: decimal("basis", { precision: 15, scale: 2 }).notNull(),
  asOfBalance: decimal("as_of_balance", { precision: 15, scale: 2 }),
  balanceAsOfMonth: integer("balance_as_of_month"),
  balanceAsOfYear: integer("balance_as_of_year"),
  interestRate: decimal("interest_rate", { precision: 7, scale: 4 }).notNull().default("0"),
  paymentType: notePaymentTypeEnum("payment_type").notNull(),
  monthlyPayment: decimal("monthly_payment", { precision: 15, scale: 2 }),
  startYear: integer("start_year").notNull(),
  startMonth: integer("start_month").notNull().default(1),
  startYearRef: yearRefEnum("start_year_ref"),
  termMonths: integer("term_months").notNull(),
  linkedTrustEntityId: uuid("linked_trust_entity_id").references(
    () => entities.id, { onDelete: "set null" }
  ),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const noteExtraPayments = pgTable("note_extra_payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  noteReceivableId: uuid("note_receivable_id")
    .notNull()
    .references(() => notesReceivable.id, { onDelete: "cascade" }),
  year: integer("year").notNull(),
  type: extraPaymentTypeEnum("type").notNull(),
  amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const noteReceivableOwners = pgTable(
  "note_receivable_owners",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    noteReceivableId: uuid("note_receivable_id")
      .notNull()
      .references(() => notesReceivable.id, { onDelete: "cascade" }),
    familyMemberId: uuid("family_member_id").references(() => familyMembers.id, {
      onDelete: "cascade",
    }),
    entityId: uuid("entity_id").references(() => entities.id, {
      onDelete: "cascade",
    }),
    externalBeneficiaryId: uuid("external_beneficiary_id").references(
      () => externalBeneficiaries.id,
      { onDelete: "cascade" },
    ),
    percent: decimal("percent", { precision: 6, scale: 4 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    exactlyOneOwner: check(
      "note_receivable_owners_one_owner",
      sql`(${t.familyMemberId} IS NOT NULL)::int
        + (${t.entityId} IS NOT NULL)::int
        + (${t.externalBeneficiaryId} IS NOT NULL)::int = 1`,
    ),
    uniqOwner: unique("note_receivable_owners_uniq")
      .on(t.noteReceivableId, t.familyMemberId, t.entityId, t.externalBeneficiaryId)
      .nullsNotDistinct(),
  }),
);

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
  // Fraction (0..1) of the rule's resolved contribution designated Roth.
  // 401(k)/403(b) only — null/0 means a fully pre-tax contribution. The
  // engine routes contribution × rothPercent into the account's Roth basis.
  rothPercent: decimal("roth_percent", { precision: 8, scale: 6 }),
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
}, (t) => ({
  // Engine load path filters savings_rules by (client_id, scenario_id) (audit F7).
  clientScenarioIdx: index("savings_rules_client_scenario_idx").on(t.clientId, t.scenarioId),
}));

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

export const planObservations = pgTable(
  "plan_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    section: planObservationSectionEnum("section").notNull(),
    topic: planObservationTopicEnum("topic").notNull().default("general"),
    title: text("title"),
    body: text("body").notNull(),
    status: planObservationStatusEnum("status").notNull().default("open"),
    owner: planObservationOwnerEnum("owner"),
    priority: openItemPriorityEnum("priority"),
    targetDate: date("target_date"),
    completedAt: timestamp("completed_at"),
    source: planObservationSourceEnum("source").notNull().default("manual"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("plan_observations_client_section_idx").on(t.clientId, t.section, t.sortOrder),
  ],
);

export type PlanObservationRow = InferSelectModel<typeof planObservations>;
export type NewPlanObservationRow = InferInsertModel<typeof planObservations>;

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
}, (t) => ({
  // Engine load path filters withdrawal_strategies by (client_id, scenario_id) (audit F7).
  clientScenarioIdx: index("withdrawal_strategies_client_scenario_idx").on(t.clientId, t.scenarioId),
}));

// ── Relations ────────────────────────────────────────────────────────────────

export const clientsRelations = relations(clients, ({ one, many }) => ({
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
  lifeInsuranceSolverSettings: one(lifeInsuranceSolverSettings, {
    fields: [clients.id],
    references: [lifeInsuranceSolverSettings.clientId],
  }),
  crmHousehold: one(crmHouseholds, {
    fields: [clients.crmHouseholdId],
    references: [crmHouseholds.id],
  }),
}));

export const crmHouseholdsRelations = relations(crmHouseholds, ({ many, one }) => ({
  contacts: many(crmHouseholdContacts),
  accounts: many(crmHouseholdAccounts),
  activity: many(crmActivity),
  documents: many(crmHouseholdDocuments),
  planningClient: one(clients, {
    fields: [crmHouseholds.id],
    references: [clients.crmHouseholdId],
  }),
}));

export const crmHouseholdContactsRelations = relations(crmHouseholdContacts, ({ one }) => ({
  household: one(crmHouseholds, {
    fields: [crmHouseholdContacts.householdId],
    references: [crmHouseholds.id],
  }),
}));

export const crmHouseholdAccountsRelations = relations(crmHouseholdAccounts, ({ one }) => ({
  household: one(crmHouseholds, {
    fields: [crmHouseholdAccounts.householdId],
    references: [crmHouseholds.id],
  }),
  contact: one(crmHouseholdContacts, {
    fields: [crmHouseholdAccounts.contactId],
    references: [crmHouseholdContacts.id],
  }),
}));

export const crmActivityRelations = relations(crmActivity, ({ one }) => ({
  household: one(crmHouseholds, {
    fields: [crmActivity.householdId],
    references: [crmHouseholds.id],
  }),
}));

export const crmHouseholdDocumentsRelations = relations(crmHouseholdDocuments, ({ one }) => ({
  household: one(crmHouseholds, {
    fields: [crmHouseholdDocuments.householdId],
    references: [crmHouseholds.id],
  }),
}));

// ── CRM Tasks ────────────────────────────────────────────────────────────────

export const crmTaskPriorityEnum   = pgEnum("crm_task_priority",   ["low", "med", "high"]);
export const crmTaskStatusEnum     = pgEnum("crm_task_status",     ["open", "in_progress", "blocked", "done"]);
export const crmTaskRecurrenceEnum = pgEnum("crm_task_recurrence", ["none", "weekly", "monthly", "quarterly"]);
export const crmTaskActivityKindEnum = pgEnum("crm_task_activity_kind", [
  "created", "status_changed", "priority_changed", "assignee_changed",
  "household_changed", "due_date_changed", "start_date_changed",
  "title_changed", "description_changed", "recurrence_changed",
  "tags_changed", "file_uploaded", "file_deleted",
  "completed", "reopened", "comment_posted",
]);

export const crmTasks = pgTable("crm_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  priority: crmTaskPriorityEnum("priority").notNull().default("med"),
  status: crmTaskStatusEnum("status").notNull().default("open"),
  dueDate: date("due_date"),
  startDate: date("start_date"),
  recurrence: crmTaskRecurrenceEnum("recurrence").notNull().default("none"),
  householdId: uuid("household_id").references(() => crmHouseholds.id, { onDelete: "set null" }),
  assigneeUserId: text("assignee_user_id"),
  createdByUserId: text("created_by_user_id").notNull(),
  completedByUserId: text("completed_by_user_id"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("crm_tasks_firm_status_idx").on(t.firmId, t.status),
  index("crm_tasks_household_idx").on(t.householdId),
  index("crm_tasks_assignee_idx").on(t.assigneeUserId),
  index("crm_tasks_firm_due_idx").on(t.firmId, t.dueDate),
]);

export const crmTags = pgTable("crm_tags", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  label: text("label").notNull(),
  color: text("color").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("crm_tags_firm_label_idx").on(t.firmId, t.label),
]);

export const crmTaskTags = pgTable("crm_task_tags", {
  taskId: uuid("task_id").notNull().references(() => crmTasks.id, { onDelete: "cascade" }),
  tagId:  uuid("tag_id").notNull().references(() => crmTags.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.taskId, t.tagId] })]);

export const crmTaskComments = pgTable("crm_task_comments", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").notNull().references(() => crmTasks.id, { onDelete: "cascade" }),
  authorUserId: text("author_user_id").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_task_comments_task_created_idx").on(t.taskId, t.createdAt),
]);

export const crmTaskCommentMentions = pgTable("crm_task_comment_mentions", {
  id: uuid("id").defaultRandom().primaryKey(),
  commentId: uuid("comment_id").notNull().references(() => crmTaskComments.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => crmTasks.id, { onDelete: "cascade" }),
  firmId: text("firm_id").notNull(),
  mentionedUserId: text("mentioned_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // The future feed's "mentions of me" query: equality on firm + user,
  // ordered by recency (btree scans backwards fine — no desc needed).
  index("crm_task_comment_mentions_feed_idx").on(t.firmId, t.mentionedUserId, t.createdAt),
  index("crm_task_comment_mentions_comment_idx").on(t.commentId),
]);

export const crmTaskActivity = pgTable("crm_task_activity", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").notNull().references(() => crmTasks.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  kind: crmTaskActivityKindEnum("kind").notNull(),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("crm_task_activity_task_created_idx").on(t.taskId, t.createdAt),
]);

export const crmTaskFiles = pgTable("crm_task_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  taskId: uuid("task_id").notNull().references(() => crmTasks.id, { onDelete: "cascade" }),
  uploadedByUserId: text("uploaded_by_user_id").notNull(),
  filename: text("filename").notNull(),
  storageProvider: text("storage_provider").notNull(),
  storageKey: text("storage_key").notNull(),
  mimeType: text("mime_type"),
  sizeBytes: bigint("size_bytes", { mode: "number" }),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
}, (t) => [
  index("crm_task_files_task_idx").on(t.taskId),
]);

// Relations
export const crmTasksRelations = relations(crmTasks, ({ one, many }) => ({
  household: one(crmHouseholds, {
    fields: [crmTasks.householdId],
    references: [crmHouseholds.id],
  }),
  tags:       many(crmTaskTags),
  comments:   many(crmTaskComments),
  mentions:   many(crmTaskCommentMentions),
  activity:   many(crmTaskActivity),
  files:      many(crmTaskFiles),
}));

export const crmTagsRelations = relations(crmTags, ({ many }) => ({
  taskTags: many(crmTaskTags),
}));

export const crmTaskTagsRelations = relations(crmTaskTags, ({ one }) => ({
  task: one(crmTasks, { fields: [crmTaskTags.taskId], references: [crmTasks.id] }),
  tag:  one(crmTags,  { fields: [crmTaskTags.tagId],  references: [crmTags.id] }),
}));

export const entitiesRelations = relations(entities, ({ one, many }) => ({
  client: one(clients, {
    fields: [entities.clientId],
    references: [clients.id],
  }),
  accounts: many(accounts),
}));

export const entityFlowOverridesRelations = relations(entityFlowOverrides, ({ one }) => ({
  entity: one(entities, {
    fields: [entityFlowOverrides.entityId],
    references: [entities.id],
  }),
  scenario: one(scenarios, {
    fields: [entityFlowOverrides.scenarioId],
    references: [scenarios.id],
  }),
}));

export const accountFlowOverridesRelations = relations(accountFlowOverrides, ({ one }) => ({
  account: one(accounts, {
    fields: [accountFlowOverrides.accountId],
    references: [accounts.id],
  }),
  scenario: one(scenarios, {
    fields: [accountFlowOverrides.scenarioId],
    references: [scenarios.id],
  }),
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
    startYear: integer("start_year").notNull(),
    startYearRef: yearRefEnum("start_year_ref"),
    endYear: integer("end_year").notNull(),
    endYearRef: yearRefEnum("end_year_ref"),
    annualAmount: decimal("annual_amount", { precision: 15, scale: 2 }).notNull(),
    amountMode: giftAmountModeEnum("amount_mode").notNull().default("fixed"),
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
    check(
      "gift_series_one_recipient",
      sql`(
        (${t.recipientEntityId} IS NOT NULL)::int +
        (${t.recipientFamilyMemberId} IS NOT NULL)::int +
        (${t.recipientExternalBeneficiaryId} IS NOT NULL)::int
      ) = 1`,
    ),
  ],
);

export const giftSeriesRelations = relations(giftSeries, ({ one }) => ({
  client: one(clients, { fields: [giftSeries.clientId], references: [clients.id] }),
  scenario: one(scenarios, { fields: [giftSeries.scenarioId], references: [scenarios.id] }),
  recipientEntity: one(entities, {
    fields: [giftSeries.recipientEntityId],
    references: [entities.id],
  }),
  recipientFamilyMember: one(familyMembers, {
    fields: [giftSeries.recipientFamilyMemberId],
    references: [familyMembers.id],
  }),
  recipientExternalBeneficiary: one(externalBeneficiaries, {
    fields: [giftSeries.recipientExternalBeneficiaryId],
    references: [externalBeneficiaries.id],
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

export const willResiduaryTierEnum = pgEnum("will_residuary_tier", [
  "primary",
  "contingent",
]);

export const wills = pgTable(
  "wills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    grantor: willGrantorEnum("grantor").notNull(),
    executor: text("executor"),
    executionDate: date("execution_date"),
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
    entityId: uuid("entity_id").references(() => entities.id, {
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

export const willResiduaryRecipients = pgTable(
  "will_residuary_recipients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    willId: uuid("will_id")
      .notNull()
      .references(() => wills.id, { onDelete: "cascade" }),
    recipientKind: willRecipientKindEnum("recipient_kind").notNull(),
    recipientId: uuid("recipient_id"),
    tier: willResiduaryTierEnum("tier").notNull().default("primary"),
    percentage: numeric("percentage", { precision: 5, scale: 2 }).notNull(),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("will_residuary_recipients_will_sort_idx").on(t.willId, t.sortOrder),
  ],
);

export const reports = pgTable(
  "reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    templateKey: text("template_key"), // null for blank
    pages: jsonb("pages").notNull().$type<unknown[]>(),
    createdByUserId: text("created_by_user_id").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("reports_client_id_idx").on(t.clientId),
    index("reports_firm_id_idx").on(t.firmId),
  ],
);

export type ReportRow = InferSelectModel<typeof reports>;
export type NewReportRow = InferInsertModel<typeof reports>;

export const willsRelations = relations(wills, ({ one, many }) => ({
  client: one(clients, { fields: [wills.clientId], references: [clients.id] }),
  bequests: many(willBequests),
  residuaryRecipients: many(willResiduaryRecipients),
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

export const willResiduaryRecipientsRelations = relations(
  willResiduaryRecipients,
  ({ one }) => ({
    will: one(wills, {
      fields: [willResiduaryRecipients.willId],
      references: [wills.id],
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
  owners: many(accountOwners),
  savingsRules: many(savingsRules),
  withdrawalStrategies: many(withdrawalStrategies),
  policy: one(lifeInsurancePolicies, {
    fields: [accounts.id],
    references: [lifeInsurancePolicies.accountId],
    relationName: "policyAccount",
  }),
  stockOptionAccount: one(stockOptionAccounts, {
    fields: [accounts.id],
    references: [stockOptionAccounts.accountId],
    relationName: "stockOptionAccount",
  }),
  stockOptionGrants: many(stockOptionGrants),
  plaidItem: one(plaidItems, {
    fields: [accounts.plaidItemId],
    references: [plaidItems.id],
  }),
}));

export const plaidItemsRelations = relations(plaidItems, ({ one, many }) => ({
  client: one(clients, {
    fields: [plaidItems.clientId],
    references: [clients.id],
  }),
  accounts: many(accounts),
  liabilities: many(liabilities),
  transactions: many(plaidTransactions),
}));

export const plaidTransactions = pgTable(
  "plaid_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    plaidItemId: uuid("plaid_item_id")
      .references(() => plaidItems.id, { onDelete: "cascade" }),
    // Resolved at ingest when the Plaid account maps to one of our `accounts`
    // rows. NULL when the source is a liability (credit card) or an untracked
    // account — `plaidAccountId` keeps the linkage either way.
    accountId: uuid("account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    // Raw Plaid account handle — the durable join key to accounts OR liabilities.
    plaidAccountId: text("plaid_account_id"),
    plaidTransactionId: text("plaid_transaction_id").unique(),
    // Plaid sign convention: positive = money OUT (spend), negative = money in.
    amount: decimal("amount", { precision: 15, scale: 2 }).notNull(),
    isoCurrencyCode: text("iso_currency_code"),
    date: date("date").notNull(),
    authorizedDate: date("authorized_date"),
    merchantName: text("merchant_name"),
    name: text("name").notNull(),
    // Personal Finance Category v2 (raw). PFC→our-category mapping is Phase 4.
    pfcPrimary: text("pfc_primary"),
    pfcDetailed: text("pfc_detailed"),
    pfcConfidence: text("pfc_confidence"),
    paymentChannel: text("payment_channel"),
    pending: boolean("pending").notNull().default(false),
    // FK → transaction_categories — added in Phase 4 alongside that table.
    categoryId: uuid("category_id").references(() => transactionCategories.id, {
      onDelete: "set null",
    }),
    categorizedBy: transactionCategorizedByEnum("categorized_by")
      .notNull()
      .default("plaid"),
    // Claimed by a recurring transaction (set at ingest/retroactively/manually).
    // SET NULL so deleting a recurring unclaims its transactions.
    recurringTransactionId: uuid("recurring_transaction_id").references(
      () => recurringTransactions.id,
      { onDelete: "set null" },
    ),
    excluded: boolean("excluded").notNull().default(false),
    // Classification source of truth: drives budget inclusion + list badge +
    // category visibility. Seeded from PFC at ingest; user-overridable.
    type: transactionTypeEnum("type").notNull().default("expense"),
    source: transactionSourceEnum("source").notNull().default("plaid"),
    // Explicit client/advisor "I've seen this charge" flag — independent of
    // category. NULL = unreviewed; a timestamp = reviewed, and when.
    reviewedAt: timestamp("reviewed_at"),
    reviewedBy: text("reviewed_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    clientDateIdx: index("plaid_transactions_client_date_idx").on(t.clientId, t.date),
    clientCategoryIdx: index("plaid_transactions_client_category_idx").on(
      t.clientId,
      t.categoryId,
    ),
    accountDateIdx: index("plaid_transactions_account_date_idx").on(t.accountId, t.date),
    recurringIdx: index("plaid_transactions_recurring_idx").on(t.recurringTransactionId),
    clientReviewedIdx: index("plaid_transactions_client_reviewed_idx").on(
      t.clientId,
      t.reviewedAt,
    ),
  }),
);

export const plaidTransactionsRelations = relations(plaidTransactions, ({ one }) => ({
  client: one(clients, {
    fields: [plaidTransactions.clientId],
    references: [clients.id],
  }),
  plaidItem: one(plaidItems, {
    fields: [plaidTransactions.plaidItemId],
    references: [plaidItems.id],
  }),
  account: one(accounts, {
    fields: [plaidTransactions.accountId],
    references: [accounts.id],
  }),
}));

export const portalNotificationKind = pgEnum("portal_notification_kind", [
  "transactions_to_review",
  "reconnect_required",
]);

// Registry of Expo push-delivery addresses for the client portal mobile app.
export const portalPushTokens = pgTable(
  "portal_push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    clerkUserId: text("clerk_user_id").notNull(),
    // Opaque Expo delivery address (not a credential). Unique = the upsert key.
    expoPushToken: text("expo_push_token").notNull().unique(),
    platform: text("platform").notNull(), // 'ios' | 'android'
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at").notNull().defaultNow(),
  },
  (t) => ({
    clientIdx: index("portal_push_tokens_client_idx").on(t.clientId),
  }),
);

// One row per delivered push-notification EVENT. Doubles as the throttle
// source (query MAX(created_at) by client/kind) and the delivery log — the
// only local evidence a push fired before TestFlight. No audit-log row: the
// send is a system side-effect of an already-audited webhook sync.
export const portalNotifications = pgTable(
  "portal_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    // Set for reconnect events (per-item throttle grain); null for transactions.
    plaidItemId: uuid("plaid_item_id").references(() => plaidItems.id, {
      onDelete: "cascade",
    }),
    kind: portalNotificationKind("kind").notNull(),
    body: text("body").notNull(),
    tokenCount: integer("token_count").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    clientKindIdx: index("portal_notifications_client_kind_idx").on(
      t.clientId,
      t.kind,
      t.createdAt,
    ),
  }),
);

export const accountOwnersRelations = relations(accountOwners, ({ one }) => ({
  account: one(accounts, {
    fields: [accountOwners.accountId],
    references: [accounts.id],
  }),
  familyMember: one(familyMembers, {
    fields: [accountOwners.familyMemberId],
    references: [familyMembers.id],
  }),
  entity: one(entities, {
    fields: [accountOwners.entityId],
    references: [entities.id],
  }),
  externalBeneficiary: one(externalBeneficiaries, {
    fields: [accountOwners.externalBeneficiaryId],
    references: [externalBeneficiaries.id],
  }),
}));

export const lifeInsurancePoliciesRelations = relations(lifeInsurancePolicies, ({ one, many }) => ({
  account: one(accounts, {
    fields: [lifeInsurancePolicies.accountId],
    references: [accounts.id],
    relationName: "policyAccount",
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

export const stockOptionAccountsRelations = relations(stockOptionAccounts, ({ one }) => ({
  account: one(accounts, {
    fields: [stockOptionAccounts.accountId],
    references: [accounts.id],
    relationName: "stockOptionAccount",
  }),
}));

export const stockOptionGrantsRelations = relations(stockOptionGrants, ({ one, many }) => ({
  account: one(accounts, {
    fields: [stockOptionGrants.accountId],
    references: [accounts.id],
  }),
  tranches: many(stockOptionVestTranches),
  plannedEvents: many(stockOptionPlannedEvents),
}));

export const stockOptionVestTranchesRelations = relations(stockOptionVestTranches, ({ one }) => ({
  grant: one(stockOptionGrants, {
    fields: [stockOptionVestTranches.grantId],
    references: [stockOptionGrants.id],
  }),
}));

export const stockOptionPlannedEventsRelations = relations(stockOptionPlannedEvents, ({ one }) => ({
  grant: one(stockOptionGrants, {
    fields: [stockOptionPlannedEvents.grantId],
    references: [stockOptionGrants.id],
  }),
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
  linkedProperty: one(accounts, {
    fields: [incomes.linkedPropertyId],
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
  plaidItem: one(plaidItems, {
    fields: [liabilities.plaidItemId],
    references: [plaidItems.id],
  }),
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

  // Medicare standard premiums (CMS-published, annual dollars). Null if year not yet seeded.
  standardPartBPremium: decimal("standard_part_b_premium", { precision: 10, scale: 2 }),
  partDNationalBase: decimal("part_d_national_base", { precision: 10, scale: 2 }),
  // IRMAA brackets (CMS-published). 5-tier surcharge schedule per filing status.
  irmaaBracketsMfj: jsonb("irmaa_brackets_mfj").$type<IrmaaTier[]>(),
  irmaaBracketsSingle: jsonb("irmaa_brackets_single").$type<IrmaaTier[]>(),

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
// Reinvestments
// ============================================================================

export const reinvestmentTargetEnum = pgEnum("reinvestment_target", [
  "model_portfolio",
  "custom",
]);

export const reinvestments = pgTable("reinvestments", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  yearRef: yearRefEnum("year_ref"),
  targetType: reinvestmentTargetEnum("target_type").notNull().default("model_portfolio"),
  modelPortfolioId: uuid("model_portfolio_id").references(() => modelPortfolios.id, { onDelete: "set null" }),
  customGrowthRate: decimal("custom_growth_rate", { precision: 5, scale: 4 }),
  customPctOrdinaryIncome: decimal("custom_pct_ordinary_income", { precision: 5, scale: 4 }),
  customPctLtCapitalGains: decimal("custom_pct_lt_capital_gains", { precision: 5, scale: 4 }),
  customPctQualifiedDividends: decimal("custom_pct_qualified_dividends", { precision: 5, scale: 4 }),
  customPctTaxExempt: decimal("custom_pct_tax_exempt", { precision: 5, scale: 4 }),
  realizeTaxesOnSwitch: boolean("realize_taxes_on_switch").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const reinvestmentAccounts = pgTable(
  "reinvestment_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reinvestmentId: uuid("reinvestment_id").notNull().references(() => reinvestments.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("reinvestment_accounts_unique").on(t.reinvestmentId, t.accountId)],
);

export const reinvestmentGroups = pgTable(
  "reinvestment_groups",
  {
    reinvestmentId: uuid("reinvestment_id")
      .notNull()
      .references(() => reinvestments.id, { onDelete: "cascade" }),
    // Default key ("all-liquid"/"taxable"/"retirement"/"cash") or custom group UUID.
    groupKey: text("group_key").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.reinvestmentId, t.groupKey] })],
);

// ============================================================================
// Roth Conversions (technique)
// ============================================================================

export const rothConversionTypeEnum = pgEnum("roth_conversion_type", [
  "fixed_amount",
  "full_account",
  "deplete_over_period",
  "fill_up_bracket",
]);

export const rothConversions = pgTable("roth_conversions", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  destinationAccountId: uuid("destination_account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  conversionType: rothConversionTypeEnum("conversion_type").notNull().default("fixed_amount"),
  fixedAmount: decimal("fixed_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  // Top of the ordinary-income bracket to fill (e.g., 0.22 = "fill up to top of 22% bracket").
  // Only meaningful when conversionType = "fill_up_bracket".
  fillUpBracket: decimal("fill_up_bracket", { precision: 5, scale: 4 }),
  startYear: integer("start_year").notNull(),
  startYearRef: yearRefEnum("start_year_ref"),
  endYear: integer("end_year"),
  endYearRef: yearRefEnum("end_year_ref"),
  // Inflation indexing (only applies to fixed_amount type).
  indexingRate: decimal("indexing_rate", { precision: 5, scale: 4 }).notNull().default("0"),
  // When set, indexing compounds from this year instead of from start_year.
  // null = "Immediately" (compound from start_year).
  inflationStartYear: integer("inflation_start_year"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rothConversionSources = pgTable("roth_conversion_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  rothConversionId: uuid("roth_conversion_id")
    .notNull()
    .references(() => rothConversions.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
  // Lower sortOrder is drained first (matters for fixed_amount when the first
  // source can't satisfy the full conversion).
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
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
  // Resell: link from a sell row to the buy row whose synthetic asset is being
  // sold. Mutually exclusive with accountId on sells (enforced by CHECK +
  // route-level Zod). ON DELETE SET NULL realizes the orphan-on-buy-delete
  // model — see add-asset-transaction-form.tsx for the "must re-source" UX.
  purchaseTransactionId: uuid("purchase_transaction_id").references(
    (): AnyPgColumn => assetTransactions.id,
    { onDelete: "set null" },
  ),
  // Sell-only. Set when the transaction sells an entire (or fractional) business
  // account. Mutually exclusive with accountId and purchaseTransactionId.
  // Must reference an account with category = 'business' (API-enforced).
  businessAccountId: uuid("business_account_id").references(() => accounts.id, { onDelete: "set null" }),
  // Partial-sale fraction. null = full sale (today's binary behavior). 0 < x ≤ 1
  // = partial. Sell-only via CHECK; null on buys.
  fractionSold: decimal("fraction_sold", { precision: 7, scale: 6 }),
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
},
(t) => [
  // Sells have AT MOST one source. All-null is allowed temporarily when the
  // referenced buy/entity is deleted (FK SET NULL cascade). Multiple sources is
  // never legal.
  check(
    "asset_transactions_sell_source_check",
    sql`${t.type} <> 'sell' OR (
      (CASE WHEN ${t.accountId} IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN ${t.purchaseTransactionId} IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN ${t.businessAccountId} IS NOT NULL THEN 1 ELSE 0 END)
    ) <= 1`,
  ),
  // Buys never carry sell-side fields.
  check(
    "asset_transactions_buy_no_source_check",
    sql`${t.type} <> 'buy' OR (${t.purchaseTransactionId} IS NULL AND ${t.accountId} IS NULL AND ${t.businessAccountId} IS NULL AND ${t.fractionSold} IS NULL)`,
  ),
  // fraction_sold must be in (0, 1] when present.
  check(
    "asset_transactions_fraction_sold_range_check",
    sql`${t.fractionSold} IS NULL OR (${t.fractionSold} > 0 AND ${t.fractionSold} <= 1)`,
  ),
  index("asset_transactions_purchase_idx")
    .on(t.purchaseTransactionId)
    .where(sql`${t.purchaseTransactionId} IS NOT NULL`),
]);

export const relocations = pgTable("relocations", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
  scenarioId: uuid("scenario_id").notNull().references(() => scenarios.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  year: integer("year").notNull(),
  destinationState: text("destination_state").notNull(),
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
    actorKind: text("actor_kind").notNull().default("advisor"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [
    index("audit_log_firm_created_idx").on(t.firmId, t.createdAt),
    index("audit_log_resource_idx").on(t.resourceType, t.resourceId),
  ],
);

export const clientImports = pgTable("client_imports", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .references(() => clients.id, { onDelete: "cascade" }),
  orgId: text("org_id").notNull(),
  scenarioId: uuid("scenario_id").references(() => scenarios.id, {
    onDelete: "set null",
  }),
  mode: importModeEnum("mode").notNull(),
  status: importStatusEnum("status").notNull().default("draft"),
  createdByUserId: text("created_by_user_id").notNull(),
  committedByUserId: text("committed_by_user_id"),
  committedAt: timestamp("committed_at"),
  // DEPRECATED (2026-06): AI import is bundled into every seat — there is no
  // free-quota credit to claim. Column retained to avoid a migration; unused.
  aiImportCounted: boolean("ai_import_counted").notNull().default(false),
  extractHoldings: boolean("extract_holdings").notNull().default(false),
  discardedAt: timestamp("discarded_at"),
  notes: text("notes"),
  payloadJson: jsonb("payload_json").notNull().default(sql`'{}'::jsonb`),
  perTabCommittedAt: jsonb("per_tab_committed_at")
    .notNull()
    .default(sql`'{}'::jsonb`),
  origin: importOriginEnum("origin").notNull().default("extraction"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientImportFiles = pgTable("client_import_files", {
  id: uuid("id").defaultRandom().primaryKey(),
  importId: uuid("import_id")
    .notNull()
    .references(() => clientImports.id, { onDelete: "cascade" }),
  blobUrl: text("blob_url").notNull(),
  blobPathname: text("blob_pathname").notNull(),
  originalFilename: text("original_filename").notNull(),
  contentHash: text("content_hash").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  detectedKind: text("detected_kind").notNull(),
  documentType: importDocumentTypeEnum("document_type").notNull().default("auto"),
  ssnRedactionCount: integer("ssn_redaction_count").notNull().default(0),
  uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
  deletedAt: timestamp("deleted_at"),
});

export const clientImportExtractions = pgTable("client_import_extractions", {
  id: uuid("id").defaultRandom().primaryKey(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => clientImportFiles.id, { onDelete: "cascade" }),
  model: extractionModelEnum("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  status: extractionStatusEnum("status").notNull().default("queued"),
  rawResponseJson: jsonb("raw_response_json"),
  warnings: jsonb("warnings"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at"),
  finishedAt: timestamp("finished_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const clientImportsRelations = relations(clientImports, ({ one, many }) => ({
  client: one(clients, { fields: [clientImports.clientId], references: [clients.id] }),
  scenario: one(scenarios, { fields: [clientImports.scenarioId], references: [scenarios.id] }),
  files: many(clientImportFiles),
}));

export const clientImportFilesRelations = relations(clientImportFiles, ({ one, many }) => ({
  import: one(clientImports, {
    fields: [clientImportFiles.importId],
    references: [clientImports.id],
  }),
  extractions: many(clientImportExtractions),
}));

export const clientImportExtractionsRelations = relations(
  clientImportExtractions,
  ({ one }) => ({
    file: one(clientImportFiles, {
      fields: [clientImportExtractions.fileId],
      references: [clientImportFiles.id],
    }),
  }),
);

// ── Billing & SOC 2 (Phase 1) ────────────────────────────────────────────────
// Note: this section uses `timestamp(..., { withTimezone: true })` (timestamptz)
// per the billing spec. The legacy tables above use plain `timestamp` (no tz);
// future work tracks backfilling them. Mixing is intentional — do not "fix" by
// stripping withTimezone here without updating the spec + the legacy tables.

export const subscriptionItemKindEnum = pgEnum("subscription_item_kind", [
  "seat",
  "addon",
]);

export const acceptanceSourceEnum = pgEnum("acceptance_source", [
  "stripe_checkout",
  "clerk_signup",
  "in_app_modal",
]);

export const reconciliationRunStatusEnum = pgEnum("reconciliation_run_status", [
  "running",
  "ok",
  "drift_detected",
  "error",
]);

export const billingEventResultEnum = pgEnum("billing_event_result", [
  "ok",
  "error",
  "ignored",
  "skipped_duplicate",
]);

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
  // DEPRECATED (2026-06): AI import is bundled into every seat — no usage
  // quota. Column retained to avoid a migration; unused.
  aiImportsUsed: integer("ai_imports_used").notNull().default(0),
  logoUrl: text("logo_url"),
  faviconUrl: text("favicon_url"),
  primaryColor: text("primary_color"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Maps a staff member (org:operations / org:planner) to the advisors whose
// book they may view. Many-to-many: one row per (staff, advisor) edge. The
// role itself lives in Clerk; only the visibility edges are persisted here.
// firmId is the Clerk org id (text, no FK — matches the crm_* convention so
// insert order is never coupled to the firms row).
export const staffAdvisorVisibility = pgTable(
  "staff_advisor_visibility",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id").notNull(),
    staffUserId: text("staff_user_id").notNull(),
    advisorUserId: text("advisor_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: text("created_by"),
  },
  (t) => [
    index("staff_advisor_visibility_firm_staff_idx").on(t.firmId, t.staffUserId),
    uniqueIndex("staff_advisor_visibility_unique_edge").on(
      t.firmId,
      t.staffUserId,
      t.advisorUserId,
    ),
  ],
);

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

// One-time beta-founder access codes. codeHash is the sha256 hex of the
// normalized plaintext code — plaintext is never persisted.
export const betaCodes = pgTable("beta_codes", {
  id: uuid("id").defaultRandom().primaryKey(),
  // sha256 hex of the normalized code body — never store plaintext.
  codeHash: text("code_hash").notNull().unique(),
  // Operator-facing label, e.g. "Jane @ Acme". Optional.
  label: text("label"),
  // Entitlements granted to the founder org on redemption.
  entitlements: jsonb("entitlements").$type<string[]>().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // redeemedAt is set atomically at claim time; the org id is filled in after
  // the founder org is created (two-phase so a mid-flow failure can compensate).
  redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
  redeemedByUserId: text("redeemed_by_user_id"),
  redeemedOrgId: text("redeemed_org_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// Foundry staff who can operate across all orgs (ops console). Keyed to the
// Clerk *user*, deliberately OUTSIDE Clerk org roles — so it neither needs nor
// consumes the B2B custom-roles add-on, and never collides with the per-org
// advisor `org:admin` role. Generalizes the retired BETA_OPERATOR allowlist.
export const opsAdmins = pgTable(
  "ops_admins",
  {
    clerkUserId: text("clerk_user_id").primaryKey(),
    email: text("email").notNull(),
    role: text("role").notNull(), // 'support' | 'ops' | 'superadmin'
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [check("ops_admins_role_check", sql`${t.role} IN ('support','ops','superadmin')`)],
);

// Per-advisor customization of the solver right-panel report tab strip: the
// order reports appear in and which are hidden. One row per Clerk *user* — the
// preference follows the advisor across every client, scenario, and firm, so it
// is deliberately NOT org-scoped. `layout` is the full ordered list with a
// visible flag per report; it is reconciled against the canonical REPORT_KEYS
// on every read (see resolveReportLayout), so adding/removing a report in code
// never breaks a stored row.
export const userSolverReportLayout = pgTable("user_solver_report_layout", {
  clerkUserId: text("clerk_user_id").primaryKey(),
  layout: jsonb("layout").$type<ReportLayoutEntry[]>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export type UserSolverReportLayoutRow = InferSelectModel<typeof userSolverReportLayout>;

// Per-org entitlement overrides set by Foundry ops staff. Append-style and
// attributable: each manual grant/revoke is its OWN row (reason + set_by +
// optional expiry), never a mutate-in-place. This table is the durable source
// of truth for manual entitlement changes; Clerk publicMetadata.entitlements is
// a derived cache rebuilt from subscription items UNIONed with active overrides
// (see deriveEntitlements + src/lib/ops/entitlements.ts). Survives the
// reconcile-billing cron, which now reads overrides before healing Clerk.
export const opsEntitlementOverrides = pgTable(
  "ops_entitlement_overrides",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id").notNull(),
    entitlement: text("entitlement").notNull(),
    mode: text("mode").notNull(), // 'grant' | 'revoke'
    reason: text("reason").notNull(),
    setBy: text("set_by").notNull(), // ops clerk_user_id
    expiresAt: timestamp("expires_at", { withTimezone: true }), // nullable; comps auto-expire
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("ops_entitlement_overrides_firm_idx").on(t.firmId, t.entitlement),
    check("ops_entitlement_overrides_mode_check", sql`${t.mode} IN ('grant','revoke')`),
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
    kind: subscriptionItemKindEnum("kind").notNull(),
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

// Webhook idempotency log + processing audit. UNIQUE on
// `stripe_event_id` is THE idempotency key — duplicate deliveries
// short-circuit at INSERT time. `payload_redacted` stores the
// non-PII event body for 90 days (cron nulls it after); the row
// itself is kept indefinitely for idempotency.
export const billingEvents = pgTable(
  "billing_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stripeEventId: text("stripe_event_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    firmId: text("firm_id"),
    receivedAt: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingDurationMs: integer("processing_duration_ms"),
    result: billingEventResultEnum("result"),
    errorMessage: text("error_message"),
    payloadRedacted: jsonb("payload_redacted"),
  },
  (t) => [
    index("billing_events_firm_received_idx").on(t.firmId, t.receivedAt),
    index("billing_events_errors_idx")
      .on(t.receivedAt)
      .where(sql`result = 'error'`),
  ],
);

// Clerk webhook idempotency log. UNIQUE on `svix_id` is THE idempotency key —
// duplicate Svix deliveries short-circuit at INSERT time. Mirrors
// billing_events but keyed on the Svix delivery id; `result` is free-text
// ('ok' | 'ignored' | 'error', null while pending) and intentionally NOT the
// Stripe billing_event_result enum.
export const clerkEvents = pgTable(
  "clerk_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    svixId: text("svix_id").notNull().unique(),
    eventType: text("event_type").notNull(),
    result: text("result"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    processingDurationMs: integer("processing_duration_ms"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("clerk_events_created_idx").on(t.createdAt)],
);

// Click-through ToS / DPA / Privacy consent log. P2 Privacy evidence.
// Three sources: stripe_checkout (pre-account), clerk_signup (invite
// accepted), in_app_modal (re-consent on version bump). firm_id is
// nullable because Stripe Checkout fires before the Clerk org exists.
export const tosAcceptances = pgTable(
  "tos_acceptances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    firmId: text("firm_id"),
    tosVersion: text("tos_version").notNull(),
    dpaVersion: text("dpa_version"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    acceptanceSource: acceptanceSourceEnum("acceptance_source").notNull(),
  },
  (t) => [
    index("tos_acceptances_user_accepted_idx").on(t.userId, t.acceptedAt),
  ],
);

// Daily reconciliation cron emits one row per run. SOC 2 CC7.1
// detective control — drift between Stripe / DB / Clerk metadata
// surfaces here. `discrepancies` stores per-firm drift detail as
// JSON for ops triage.
export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    status: reconciliationRunStatusEnum("status").notNull(),
    firmsChecked: integer("firms_checked"),
    discrepanciesFound: integer("discrepancies_found"),
    discrepancies: jsonb("discrepancies"),
    errorMessage: text("error_message"),
  },
  (t) => [index("reconciliation_runs_started_idx").on(t.startedAt)],
);

// ============================================================================
// Life Insurance Solver Settings (per-client, global — not scenario-scoped)
// ============================================================================

export const lifeInsuranceSolverSettings = pgTable("life_insurance_solver_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: "cascade" }),
  deathYear: integer("death_year").notNull(),
  modelPortfolioId: uuid("model_portfolio_id").references(() => modelPortfolios.id, {
    onDelete: "set null",
  }),
  leaveToHeirsAmount: decimal("leave_to_heirs_amount", { precision: 15, scale: 2 }).notNull(),
  livingExpenseAtDeath: decimal("living_expense_at_death", { precision: 15, scale: 2 }),
  payoffLiabilityIds: jsonb("payoff_liability_ids")
    .$type<string[]>()
    .notNull()
    .default([]),
  mcTargetScore: decimal("mc_target_score", { precision: 5, scale: 4 }).notNull().default("0.9"),
  coverEstateTaxes: boolean("cover_estate_taxes").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const lifeInsuranceSolverSettingsRelations = relations(
  lifeInsuranceSolverSettings,
  ({ one }) => ({
    client: one(clients, {
      fields: [lifeInsuranceSolverSettings.clientId],
      references: [clients.id],
    }),
  }),
);

export type LifeInsuranceSolverSettingsRow = InferSelectModel<typeof lifeInsuranceSolverSettings>;
export type NewLifeInsuranceSolverSettingsRow = InferInsertModel<typeof lifeInsuranceSolverSettings>;

// ============================================================================
// Client Insight Profiles (per-client, global — AI-generated 360 cache)
// ============================================================================

export const clientInsightProfiles = pgTable("client_insight_profiles", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: "cascade" }),
  snapshot: text("snapshot").notNull().default(""),
  goals: text("goals").notNull().default(""),
  opportunities: text("opportunities").notNull().default(""),
  inputHash: text("input_hash").notNull().default(""),
  model: text("model").notNull().default(""),
  generatedByUserId: text("generated_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const clientInsightProfilesRelations = relations(
  clientInsightProfiles,
  ({ one }) => ({
    client: one(clients, {
      fields: [clientInsightProfiles.clientId],
      references: [clients.id],
    }),
  }),
);

export type ClientInsightProfileRow = InferSelectModel<typeof clientInsightProfiles>;
export type NewClientInsightProfileRow = InferInsertModel<typeof clientInsightProfiles>;

// Presentation templates: a saved, ordered list of presentation pages
// with their per-page options. Firm-scoped; either shared (any firm
// member sees them) or private (only the creator sees them). Page
// descriptors validated against the registry's per-pageId optionsSchema
// at the API boundary, so this column is a generic jsonb.
export const presentationTemplates = pgTable(
  "presentation_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.firmId, { onDelete: "cascade" }),
    createdByUserId: text("created_by_user_id").notNull(),
    visibility: text("visibility", { enum: ["shared", "private"] })
      .notNull()
      .default("private"),
    name: text("name").notNull(),
    pages: jsonb("pages").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("presentation_templates_firm_visibility_idx").on(t.firmId, t.visibility),
    index("presentation_templates_firm_creator_idx").on(t.firmId, t.createdByUserId),
    uniqueIndex("presentation_templates_unique_name_per_creator_visibility_idx")
      .on(t.firmId, t.visibility, t.createdByUserId, t.name),
  ],
);

export type PresentationTemplateRow = InferSelectModel<typeof presentationTemplates>;
export type NewPresentationTemplateRow = InferInsertModel<typeof presentationTemplates>;

// Per-user dismissals of code-defined built-in presentation templates.
// Built-ins aren't rows; hiding one records a dismissal that filters it out of
// that user's launcher list. Per-user scope: hiding never affects colleagues.
export const builtinTemplateDismissals = pgTable(
  "builtin_template_dismissals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.firmId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    builtinSlug: text("builtin_slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("builtin_template_dismissals_unique_idx").on(
      t.firmId,
      t.userId,
      t.builtinSlug,
    ),
    index("builtin_template_dismissals_firm_user_idx").on(t.firmId, t.userId),
  ],
);

export type BuiltinTemplateDismissalRow = InferSelectModel<
  typeof builtinTemplateDismissals
>;
export type NewBuiltinTemplateDismissalRow = InferInsertModel<
  typeof builtinTemplateDismissals
>;

// Scenario compute cache: content-addressed store for expensive compute results
// (Monte Carlo, Life Insurance solve). One row per (scenarioId, kind), keyed by
// a SHA-256 hash of the normalized inputs. `payload` is intentionally untyped
// jsonb — helper code in lib/ casts it to the appropriate result type at the
// read boundary, avoiding a db→lib import cycle.
export const scenarioComputeCache = pgTable(
  "scenario_compute_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.firmId, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    scenarioId: uuid("scenario_id")
      .notNull()
      .references(() => scenarios.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["monte_carlo", "life_insurance_solve", "max_spending"] }).notNull(),
    inputHash: text("input_hash").notNull(),
    trials: integer("trials").notNull(),
    engineVersion: integer("engine_version").notNull(),
    payload: jsonb("payload").notNull(),
    computeMs: integer("compute_ms"),
    computedAt: timestamp("computed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("scenario_compute_cache_scenario_kind_idx").on(t.scenarioId, t.kind),
    index("scenario_compute_cache_client_idx").on(t.clientId),
  ],
);

export type ScenarioComputeCacheRow = InferSelectModel<typeof scenarioComputeCache>;
export type NewScenarioComputeCacheRow = InferInsertModel<typeof scenarioComputeCache>;

/**
 * Transient Monte Carlo cache for the Live Solver's *edited* working trees.
 *
 * The solver only needs probability-of-success (a single float). Unedited
 * entry hits the persistent `scenario_compute_cache` via getOrComputeMonteCarlo;
 * edited (transient) trees land here, keyed by a sha256 of all MC inputs
 * (hashMonteCarloInputs — folds in engineVersion + trials, so a bump
 * auto-invalidates). Rows are pruned by age (~7 days) opportunistically on write.
 */
export const solverMcCache = pgTable(
  "solver_mc_cache",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.firmId, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    successRate: doublePrecision("success_rate").notNull(),
    // Full report payload for the solver Monte Carlo tab. Nullable: legacy rows
    // (written before 0191) carry only success_rate; a full-result read treats a
    // null here as a miss and recomputes. Pruned with the row after ~7 days.
    result: jsonb("result").$type<import("@/lib/compute-cache/monte-carlo").CachedMonteCarloResult>(),
    computedAt: timestamp("computed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    uniqueIndex("solver_mc_cache_client_hash_idx").on(t.clientId, t.inputHash),
    index("solver_mc_cache_computed_at_idx").on(t.computedAt),
  ],
);

export type SolverMcCacheRow = InferSelectModel<typeof solverMcCache>;
export type NewSolverMcCacheRow = InferInsertModel<typeof solverMcCache>;

// --- Planning Forge ---
// One row per chat thread. id doubles as the LangGraph checkpointer thread_id.
// userId/firmId are Clerk ids (text), matching clients.firmId (text). clientId
// is the client-scoped thread target (null = firm-level thread, Phase 2+).
export const forgeConversations = pgTable(
  "forge_conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id").notNull(),
    firmId: text("firm_id").notNull(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    title: text("title").notNull().default("New conversation"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("forge_conversations_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

// ── Planning KB ───────────────────────────────────────────────────────────────

export const kbSourceEnum = pgEnum("kb_source", [
  "planning_playbook",
  "tax_reference",
  "client_document",
  "firm_note",
  "other",
]);

export const planningKbChunks = pgTable(
  "planning_kb_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: kbSourceEnum("source").notNull(),
    sourceRef: text("source_ref").notNull(),
    firmId: text("firm_id"),                       // null = global/curated seed
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
    chunkText: text("chunk_text").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector1536("embedding").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("planning_kb_chunks_content_hash_uq").on(t.contentHash),
    index("planning_kb_chunks_firm_id_idx").on(t.firmId),
    index("planning_kb_chunks_client_id_idx").on(t.clientId),
  ],
);

// --- Cross-Org Client Sharing ---
// One row per cross-org sharing grant. firmId/ownerUserId are the OWNING firm
// + advisor (the client's). recipientUserId is the resolved Clerk user the
// access is granted to. Revoke = set revokedAt (history preserved). Visibility
// enums use text({enum}) like presentation_templates.visibility — no pgEnum DDL.
export const clientShares = pgTable(
  "client_shares",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id").notNull(),
    ownerUserId: text("owner_user_id").notNull(),
    recipientUserId: text("recipient_user_id").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    scope: text("scope", { enum: ["all", "client"] }).notNull(),
    clientId: uuid("client_id").references(() => clients.id, {
      onDelete: "cascade",
    }),
    permission: text("permission", { enum: ["view", "edit"] }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdBy: text("created_by").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("client_shares_recipient_idx").on(t.recipientUserId, t.revokedAt),
    index("client_shares_owner_idx").on(t.firmId, t.ownerUserId),
    // One active share-all per (owner, recipient).
    uniqueIndex("client_shares_active_all_idx")
      .on(t.ownerUserId, t.recipientUserId)
      .where(sql`${t.scope} = 'all' AND ${t.revokedAt} IS NULL`),
    // One active per-client share per (client, recipient).
    uniqueIndex("client_shares_active_client_idx")
      .on(t.clientId, t.recipientUserId)
      .where(sql`${t.scope} = 'client' AND ${t.revokedAt} IS NULL`),
  ],
);

export type ClientShareRow = InferSelectModel<typeof clientShares>;
export type NewClientShareRow = InferInsertModel<typeof clientShares>;

// ---------------------------------------------------------------------------
// Orion Advisor Tech integration tables
// ---------------------------------------------------------------------------

export const orionConnections = pgTable("orion_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: text("firm_id").notNull().unique(),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  status: orionConnectionStatusEnum("status").notNull().default("connected"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastSyncError: text("last_sync_error"),
  connectedByUserId: text("connected_by_user_id"),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const orionHouseholdLinks = pgTable(
  "orion_household_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firmId: text("firm_id").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" })
      .unique(),
    orionHouseholdId: text("orion_household_id").notNull(),
    linkedByUserId: text("linked_by_user_id"),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    firmHouseholdUnique: uniqueIndex("orion_household_firm_hh_uq").on(
      t.firmId,
      t.orionHouseholdId,
    ),
  }),
);

export const orionOauthStates = pgTable("orion_oauth_states", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: text("firm_id").notNull(),
  userId: text("user_id").notNull(),
  state: text("state").notNull().unique(),
  codeVerifier: text("code_verifier").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const orionSyncRuns = pgTable("orion_sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  firmId: text("firm_id").notNull(),
  trigger: orionSyncTriggerEnum("trigger").notNull(),
  status: text("status").notNull(),
  householdsSynced: integer("households_synced").notNull().default(0),
  accountsCommitted: integer("accounts_committed").notNull().default(0),
  accountsQueued: integer("accounts_queued").notNull().default(0),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// ── Intake Forms ──────────────────────────────────────────────────────────────

export const intakeForms = pgTable("intake_forms", {
  id: uuid("id").defaultRandom().primaryKey(),
  firmId: text("firm_id").notNull(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  mode: intakeModeEnum("mode").notNull(),
  status: intakeStatusEnum("status").notNull().default("draft"),
  token: text("token").notNull(),
  recipientEmail: text("recipient_email").notNull(),
  recipientName: text("recipient_name"),
  payload: jsonb("payload").$type<IntakePayload>().notNull().default({} as unknown as IntakePayload),
  createdByUserId: text("created_by_user_id").notNull(),
  sentAt: timestamp("sent_at"),
  submittedAt: timestamp("submitted_at"),
  appliedAt: timestamp("applied_at"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("intake_forms_token_idx").on(t.token),
  index("intake_forms_firm_idx").on(t.firmId),
  index("intake_forms_client_idx").on(t.clientId),
  index("intake_forms_status_idx").on(t.status),
]);

// Per-advisor customization of the client data-collection invitation email.
// One row per (firm, advisor). Every editable column is nullable — a null
// means "use the system default" (see src/lib/intake/defaults.ts), so an
// advisor who never opens the editor needs no row at all.
export const intakeEmailSettings = pgTable(
  "intake_email_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    firmId: text("firm_id")
      .notNull()
      .references(() => firms.firmId, { onDelete: "cascade" }),
    userId: text("user_id").notNull(), // Clerk advisor id (the owner)
    fromName: text("from_name"),
    subject: text("subject"),
    introBody: text("intro_body"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("intake_email_settings_firm_user_idx").on(t.firmId, t.userId),
  ],
);

export type IntakeEmailSettingsRow = InferSelectModel<typeof intakeEmailSettings>;
export type NewIntakeEmailSettingsRow = InferInsertModel<typeof intakeEmailSettings>;

// ── Transaction Categories & Rules (client portal spending) ───────────────────

export const transactionCategories = pgTable(
  "transaction_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    // null = top-level group; set = leaf category belonging to that group.
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    // Stable identifier for seeded system categories (PFC mapping target).
    // null for user-created categories.
    slug: text("slug"),
    icon: text("icon"),
    // A `var(--data-*)` token string, e.g. "var(--data-blue)".
    color: text("color").notNull().default("var(--data-grey)"),
    sortOrder: integer("sort_order").notNull().default(0),
    kind: transactionCategoryKindEnum("kind").notNull(),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    clientIdx: index("transaction_categories_client_idx").on(t.clientId),
    // One system slug per client (user categories have null slug → not constrained).
    clientSlugUniq: uniqueIndex("transaction_categories_client_slug_uniq")
      .on(t.clientId, t.slug)
      .where(sql`${t.slug} IS NOT NULL`),
    parentFk: foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: "transaction_categories_parent_fk",
    }).onDelete("cascade"),
  }),
);

export const transactionRules = pgTable(
  "transaction_rules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    matchType: transactionMatchTypeEnum("match_type").notNull(),
    // Matched (case-insensitively) against merchantName then name.
    pattern: text("pattern").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => transactionCategories.id, { onDelete: "cascade" }),
    // Lower wins when multiple rules match.
    priority: integer("priority").notNull().default(100),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    clientPriorityIdx: index("transaction_rules_client_priority_idx").on(
      t.clientId,
      t.priority,
    ),
  }),
);

export const budgets = pgTable(
  "budgets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    // One budget per category. categoryId may reference a GROUP or a LEAF
    // (group-level budgets are allowed; see the Phase 5 plan precedence rule).
    // Globally unique → at most one budget per category per client.
    categoryId: uuid("category_id")
      .notNull()
      .unique()
      .references(() => transactionCategories.id, { onDelete: "cascade" }),
    monthlyAmount: decimal("monthly_amount", { precision: 15, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    clientIdx: index("budgets_client_idx").on(t.clientId),
  }),
);

export const budgetsRelations = relations(budgets, ({ one }) => ({
  client: one(clients, {
    fields: [budgets.clientId],
    references: [clients.id],
  }),
  category: one(transactionCategories, {
    fields: [budgets.categoryId],
    references: [transactionCategories.id],
  }),
}));

export const recurringTransactions = pgTable(
  "recurring_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    matchType: transactionMatchTypeEnum("match_type").notNull(),
    // Matched (case-insensitively) against merchantName then name.
    pattern: text("pattern").notNull(),
    // Inclusive amount window (spend-positive). A tx matches when amount is in [min, max].
    amountMin: decimal("amount_min", { precision: 15, scale: 2 }).notNull(),
    amountMax: decimal("amount_max", { precision: 15, scale: 2 }).notNull(),
    cadence: recurringCadenceEnum("cadence").notNull(),
    // Day-of-month expected (1-31), or NULL = "anytime in the month". Monthly only.
    dueDay: integer("due_day"),
    // Month it is due (1-12) for ANNUAL cadence; NULL for monthly.
    dueMonth: integer("due_month"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => transactionCategories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    clientIdx: index("recurring_transactions_client_idx").on(t.clientId),
  }),
);

export const recurringTransactionsRelations = relations(
  recurringTransactions,
  ({ one }) => ({
    client: one(clients, {
      fields: [recurringTransactions.clientId],
      references: [clients.id],
    }),
    category: one(transactionCategories, {
      fields: [recurringTransactions.categoryId],
      references: [transactionCategories.id],
    }),
  }),
);

// Client-controlled switches for what budgeting data the advisor may see
// (portal Settings → Privacy). Missing row = share everything (the
// pre-feature behavior). Client-scoped with no firm_id column: firm purge
// erases it via the clients cascade.
export const portalPrivacySettings = pgTable("portal_privacy_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  clientId: uuid("client_id")
    .notNull()
    .unique()
    .references(() => clients.id, { onDelete: "cascade" }),
  shareTransactions: boolean("share_transactions").notNull().default(true),
  shareBudgets: boolean("share_budgets").notNull().default(true),
  shareRecurrings: boolean("share_recurrings").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
