// Single source of truth for how each firm-scoped (firm_id) table is erased on
// firm purge. The live-DB drift test (purge-coverage.test.ts) asserts every
// public table with a firm_id column appears in exactly one set below; the
// mocked purge test asserts each PURGED_FIRM_TABLES entry is actually deleted.
// Derived from the live schema 2026-07-07 (audit 2026-07-07-verify-first-hotlist F2).

/** Deleted by an explicit `where(firm_id = X)` in purgeFirmById — directly, or
 *  via purgeCrmHouseholdById for clients/crm_households. */
export const PURGED_FIRM_TABLES: readonly string[] = [
  // existing coverage
  "clients",
  "crm_households",
  "invoices",
  "subscriptions",
  "crm_tasks",
  "crm_tags",
  "presentation_templates",
  "cma_sets",
  "asset_classes",
  "model_portfolios",
  // new — leaf firm-scoped tables that had no coverage
  "cma_settings",
  "ticker_portfolios",
  "staff_advisor_visibility",
  "integration_connections",
  "integration_oauth_states",
  "integration_sync_runs",
  "intake_forms",
  "intake_email_settings",
  "ops_entitlement_overrides",
  "builtin_template_dismissals",
  // new — nullable client/household FK ⇒ firm-level rows survive the client cascade
  "client_shares", // share-all rows have client_id NULL
  "planning_kb_chunks", // firm-level chunks have client_id NULL
  "forge_conversations", // global (non-client) conversations have client_id NULL
  // new — per-advisor branding (Task 14): leaf table, no FK to clients/
  // crm_households, so nothing cascades it.
  "advisor_profiles",
  // new — leaf firm-scoped tables keyed by (firm_id, advisor/user id) with no
  // FK to clients or crm_households, so the household cascade never reaches
  // them. All seven below verified present on BOTH dev and prod 2026-09-03.
  "advisor_onboarding",
  "compliance_export_batches",
  "notification_preferences",
  "ops_user_entitlement_overrides",
  "story_voice_profiles",
  // notifications: client_id is NULLABLE (the data-plumbing categories are not
  // client-scoped), so firm-level rows survive the client cascade.
  "notifications",
  // story_voice_samples: source_client_id is ON DELETE SET NULL, so a harvested
  // sample survives its source client's deletion — and it holds prose the
  // advisor lifted from a real client report.
  "story_voice_samples",
];

/** Removed transitively by a cascade purgeFirmById triggers — each has a
 *  NOT-NULL cascade FK to a purged parent (clients / crm_households /
 *  crm_tasks / subscriptions). */
export const CASCADE_COVERED_FIRM_TABLES: readonly string[] = [
  "crm_activity", // household_id NOT NULL → crm_households
  "crm_document_folders", // household_id NOT NULL → crm_households
  "crm_household_views", // household_id NOT NULL → crm_households
  "crm_task_comment_mentions", // task_id → crm_tasks
  "divorce_plans", // client_id NOT NULL → clients
  "forge_meeting_transcripts", // household_id + client_id NOT NULL
  "generation_runs", // household_id NOT NULL → crm_households
  "integration_household_links", // client_id NOT NULL → clients
  "reports", // client_id NOT NULL → clients
  "scenario_compute_cache", // client_id NOT NULL → clients
  "solver_mc_cache", // client_id NOT NULL → clients
  "subscription_items", // subscription_id NOT NULL → subscriptions
  // Risk profiles: all three have client_id NOT NULL with ON DELETE CASCADE to
  // clients, which purgeCrmHouseholdById already removes.
  "client_risk_profiles",
  "client_risk_profile_events",
  "risk_questionnaires",
  // from_household_id + to_household_id NOT NULL → crm_households
  "crm_household_relationships",
  // client_id NOT NULL → clients (firm_id also cascades from firms)
  "investment_proposals",
];

/** Intentionally retained (legal / evidence). */
export const RETAIN_ALLOWLIST_FIRM_TABLES: readonly string[] = [
  "audit_log", // SOC-2 7yr retention; holds the firm.purged record
  "billing_events", // Stripe idempotency log; firm_id is nullable
  "tos_acceptances", // GDPR proof-of-consent — legal evidence
  "firms", // the purge record itself (PII nulled, row kept)
];

/** Tables with NO Drizzle schema object that linger on the dev branch only —
 *  each verified ABSENT on prod 2026-09-03. Not purge targets: there is no
 *  schema object to delete, and on prod the tables don't exist. Excluded here
 *  so the live-DB drift guard stays honest on both dev and prod.
 *
 *   - comparison_templates / client_comparisons: dropped by migration
 *     0151_retire_comparison_tables, unapplied on dev (a dev migration-ledger
 *     drift, tracked in future-work/schema).
 *   - orion_*: dropped by 0220_integration_connections, which replaced them
 *     with the provider-agnostic integration_* tables — all four of those ARE
 *     covered above. Same dev-only ledger drift.
 *   - _bk_investment_proposals_20260817: an ad-hoc dev backup snapshot from the
 *     investment-proposals work; no migration, no schema object. */
export const RETIRED_UNMANAGED_FIRM_TABLES: readonly string[] = [
  "comparison_templates",
  "client_comparisons",
  "orion_connections",
  "orion_household_links",
  "orion_oauth_states",
  "orion_sync_runs",
  "_bk_investment_proposals_20260817",
];

/** Union of all four sets — the drift test checks every firm_id table is here. */
export const ALL_CATEGORIZED_FIRM_TABLES: ReadonlySet<string> = new Set([
  ...PURGED_FIRM_TABLES,
  ...CASCADE_COVERED_FIRM_TABLES,
  ...RETAIN_ALLOWLIST_FIRM_TABLES,
  ...RETIRED_UNMANAGED_FIRM_TABLES,
]);
