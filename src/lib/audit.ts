import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

/**
 * Write-side audit log. Every mutating handler that performs a
 * destructive or high-privilege action should append a row here so
 * SOC-2 has evidence of who did what, when, against which record.
 *
 * Keep this helper resilient: audit failures must never break the
 * request (we log and swallow). A missing audit entry is less bad
 * than a 500 on a delete the advisor just saw succeed.
 */

// Explicit union so new action types surface as a TS error until
// they're wired into the audit taxonomy. Grouped by resource family
// for SOC-2 auditor readability.
export type AuditAction =
  // Clients
  | "client.create"
  | "client.update"
  | "client.delete"
  | "client.onboarding_state.update"
  | "client.onboarding.finish"
  | "client.quick_start_state.update"
  | "client.base_facts.update"
  // Accounts (balance-sheet line items)
  | "account.create"
  | "account.update"
  | "account.delete"
  | "account.allocation.update"
  | "account.reset_growth"
  | "account_flow_overrides.replace"
  | "account.holding.create"
  | "account.holding.update"
  | "account.holding.delete"
  | "account.holding.override.update"
  | "client.holdings.refresh"
  // Liabilities
  | "liability.create"
  | "liability.update"
  | "liability.delete"
  | "extra_payment.create"
  | "extra_payment.update"
  | "extra_payment.delete"
  // Notes receivable (lender-side installment notes)
  | "note_receivable.create"
  | "note_receivable.update"
  | "note_receivable.delete"
  | "note_receivable.extra_payments.replace"
  // Cash flow
  | "income.create"
  | "income.update"
  | "income.delete"
  | "income.schedule.update"
  | "expense.create"
  | "expense.update"
  | "expense.delete"
  | "expense.schedule.update"
  | "savings_rule.create"
  | "savings_rule.update"
  | "savings_rule.delete"
  | "savings_rule.schedule.update"
  // Tax / deductions
  | "deduction.create"
  | "deduction.update"
  | "deduction.delete"
  // Scenario-level movements
  | "transfer.create"
  | "transfer.update"
  | "transfer.delete"
  | "reinvestment.create"
  | "reinvestment.update"
  | "reinvestment.delete"
  | "roth_conversion.create"
  | "roth_conversion.update"
  | "roth_conversion.delete"
  | "asset_transaction.create"
  | "asset_transaction.update"
  | "asset_transaction.delete"
  | "withdrawal_strategy.create"
  | "withdrawal_strategy.update"
  | "withdrawal_strategy.delete"
  // Plan structure
  | "plan_settings.update"
  | "entity.create"
  | "entity.update"
  | "entity.delete"
  | "revocable_trust.create"
  | "revocable_trust.update"
  | "revocable_trust.delete"
  | "entity_flow_overrides.replace"
  | "trust_split_interest.create"
  | "trust_split_interest.update"
  | "family_member.create"
  | "family_member.update"
  | "family_member.delete"
  // Estate flow — gifts (one-off + recurring series) and wills
  | "gift.create"
  | "gift.update"
  | "gift.delete"
  | "gift_series.create"
  | "gift_series.update"
  | "gift_series.delete"
  | "will.create"
  | "will.update"
  | "will.delete"
  // Reports & comments
  | "report_comment.create"
  | "report_comment.update"
  // Reports v1 (PDF report builder)
  | "report.create"
  | "report.rename"
  | "report.delete"
  | "report.ai_generate"
  | "comparison_layout.upsert"
  | "comparison.ai_generate"
  | "comparison.ai_describe_changes"
  | "client_comparison.create"
  | "client_comparison.update"
  | "client_comparison.delete"
  | "comparison.export_pdf"
  | "presentations.export_pdf"
  | "presentations.preview_pdf"
  | "comparison_template.create"
  | "comparison_template.update"
  | "comparison_template.delete"
  // Document extraction (LLM call)
  | "client.extract"
  // Stock options (equity accounts)
  | "account.stock_options.create"
  | "account.stock_options.update"
  | "account.stock_options.delete"
  | "account.stock_options.grant.create"
  | "account.stock_options.grant.update"
  | "account.stock_options.grant.delete"
  // Life insurance
  | "insurance_policy.create"
  | "insurance_policy.update"
  | "insurance_policy.delete"
  | "life_insurance_solver_settings.update"
  // CMA (firm-level, admin-gated)
  | "cma.asset_class.create"
  | "cma.asset_class.update"
  | "cma.asset_class.delete"
  | "cma.model_portfolio.create"
  | "cma.model_portfolio.update"
  | "cma.model_portfolio.delete"
  | "cma.model_portfolio.allocation.update"
  | "cma.seed"
  | "cma.migrate-to-standard"
  | "cma.refresh-standard-values"
  | "cma.refresh-projected-values"
  | "cma.set.values.update"
  | "cma.set.activate"
  | "cma.ticker_portfolio.create"
  | "cma.ticker_portfolio.update"
  | "cma.ticker_portfolio.delete"
  | "cma.ticker_portfolio.holdings.update"
  | "cma.settings.update"
  // Open items (client-scoped to-do / data-gathering tracker)
  | "open_item.create"
  | "open_item.update"
  | "open_item.complete"
  | "open_item.delete"
  // Scenario builder (per-scenario diff overlay; the writer at
  // src/lib/scenario/changes-writer.ts is the only sanctioned path for
  // non-base-case mutations on overlayable tables).
  | "scenario_change.upsert"
  | "scenario_change.revert"
  // Scenario lifecycle (CRUD on the scenarios row itself).
  | "scenario.create"
  | "scenario.rename"
  | "scenario.duplicate"
  | "scenario.delete"
  | "scenario.promote_to_base"
  // Toggle groups (per-scenario named buckets that gate scenario_changes).
  | "toggle_group.create"
  | "toggle_group.rename"
  | "toggle_group.set_default"
  | "toggle_group.set_required"
  | "toggle_group.delete"
  // Reassign a single scenario_change row into (or out of) a toggle group.
  // Used by Plan 2 Task 20's retroactive-group action bar.
  | "toggle_group.move_change"
  // Per-change enable/disable toggle on the comparison-page Changes drawer.
  | "scenario_change.set_enabled"
  // Per-change custom label (rename) or reset to computed smart label (null).
  | "scenario_change.rename"
  // Scenario snapshots (frozen comparisons; survive scenario deletion).
  | "snapshot.create"
  | "snapshot.delete"
  // Import tool v2 (durable draft-state import flow)
  | "import.created"
  | "import.discarded"
  | "import.payload.edited"
  | "import.file.uploaded"
  | "import.file.viewed"
  | "import.file.deleted"
  | "import.file.document_type_updated"
  | "import.extraction.started"
  | "import.extraction.completed"
  | "import.extraction.failed"
  | "import.match.run"
  | "import.commit.tab"
  // Billing (Phase 1+ — written by webhook handlers and admin endpoints)
  | "billing.checkout_started"
  | "billing.portal_opened"
  | "billing.subscription_created"
  | "billing.subscription_updated"
  | "billing.canceled"
  | "billing.addon_added"
  | "billing.addon_removed"
  | "billing.payment_failed"
  | "billing.payment_recovered"
  | "billing.email_queued"
  | "billing.dispute_created"
  | "billing.reconcile_healed"
  | "billing.access_denied"
  | "billing.dispute_closed"
  // Ops console (cross-org staff actions; actorId = ops user, firmId = target)
  | "ops.entitlement.granted"
  | "ops.entitlement.revoked"
  | "ops.billing.portal_opened"
  | "ops.billing.trial_extended"
  | "ops.impersonation.started"
  | "ops.impersonation.ended"
  // Org membership lifecycle (mirrors Clerk events)
  | "member.invited"
  | "member.removed"
  | "member.role_changed"
  // Firm-level lifecycle
  | "firm.name_changed"
  | "firm.archived"
  | "firm.purged"
  | "firm.founder_initialized"
  | "beta_code.redeemed"
  | "beta_code.minted"
  | "beta_code.revoked"
  | "firm.branding_logo_changed"
  | "firm.branding_favicon_changed"
  | "firm.branding_color_changed"
  // CRM (lightweight household / contact / account records that may or
  // may not be linked to a planning client).
  | "crm.household.create"
  | "crm.household.update"
  | "crm.household.delete"
  | "crm.household.soft_delete"
  | "crm.household.restore"
  | "crm.contact.create"
  | "crm.contact.update"
  | "crm.contact.delete"
  | "crm.account.create"
  | "crm.account.update"
  | "crm.account.delete"
  | "crm.import.preview"
  | "crm.import.commit"
  | "crm.document.create"
  | "crm.document.delete"
  // CRM Tasks
  | "crm.task.create"
  | "crm.task.update"
  | "crm.task.delete"
  | "crm.task.status_changed"
  | "crm.task.comment"
  | "crm.task.file_uploaded"
  | "crm.task.file_deleted"
  | "crm.tag.create"
  // CRM Notes (view over crm_activity)
  | "crm.note.create"
  | "crm.note.update"
  | "crm.note.delete"
  // Medicare coverage (per-person, client-scoped overrides)
  | "medicare_coverage.upsert"
  // Presentation templates
  | "presentation_template.create"
  | "presentation_template.update"
  | "presentation_template.delete"
  | "presentation_template.dismiss_builtin"
  | "presentation_template.restore_builtin"
  // Account groups
  | "account_group.create"
  | "account_group.update"
  | "account_group.delete"
  // Document Vault (foldered per-household document store)
  | "vault.folder.create"
  | "vault.folder.rename"
  | "vault.folder.delete"
  | "vault.document.update"
  | "vault.document.move"
  | "vault.document.version_added"
  // Support & feedback
  | "support.message_sent"
  // Planning Forge (LLM agent). New writes emit forge.*; the copilot.* variants
  // are LEGACY — rows written before the 2026-06-17 copilot→Forge rename cutover.
  // They remain in the union so historical audit rows still type-check/decode;
  // they are NOT backfilled (the audit log is append-only/immutable).
  | "forge.query" // a user turn was submitted to Forge
  | "forge.tool_call" // the agent invoked a read/compute/write tool
  | "forge.write_proposed" // a write tool produced a preview, awaiting approval
  | "forge.write_approved" // the advisor confirmed a proposed write (executed)
  | "forge.write_rejected" // the advisor rejected a proposed write
  | "copilot.query" // legacy (pre-2026-06-17 cutover)
  | "copilot.tool_call" // legacy
  | "copilot.write_proposed" // legacy
  | "copilot.write_approved" // legacy
  | "copilot.write_rejected" // legacy
  | "feedback.submitted";

type Args = {
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  clientId?: string | null;
  firmId: string;
  metadata?: Record<string, unknown>;
  // Override the default `auth().userId` actor. Use for unauthenticated
  // inbound callers that still produce a real audit event — e.g.
  // "clerk:webhook" for Clerk-signed webhook deliveries. Without this,
  // such callers get logged as "system", losing the distinction from
  // admin-triggered actions.
  actorId?: string;
};

export async function recordAudit(args: Args): Promise<void> {
  try {
    let actorId = args.actorId;
    let metadata: Record<string, unknown> | null = args.metadata ?? null;
    // Resolve the actor only when no explicit override was passed — keeps the
    // webhook path from ever calling auth(). During impersonation the session
    // belongs to the advisor (userId) but was minted by an ops operator
    // (actor.sub); attribute the action to the operator and stamp the
    // impersonated advisor in metadata. No schema change — rides in jsonb.
    if (!actorId) {
      const { userId, actor } = await auth();
      const opsActor = typeof actor?.sub === "string" ? actor.sub : null;
      if (opsActor) {
        actorId = opsActor;
        metadata = { ...(metadata ?? {}), actingAsAdvisor: userId ?? null };
      } else {
        actorId = userId ?? "system";
      }
    }
    await db.insert(auditLog).values({
      firmId: args.firmId,
      actorId,
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      clientId: args.clientId ?? null,
      metadata,
    });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message.slice(0, 200) : "unknown audit error";
    console.error("[audit] failed to record:", { action: args.action, err: msg });
  }
}

export {
  recordCreate,
  recordUpdate,
  recordDelete,
} from "./audit/record-helpers";
export type {
  AuditMetadata,
  EntitySnapshot,
  FieldChange,
  FieldLabels,
  ReferenceValue,
  DiffFormat,
  AuditValue,
} from "./audit/types";
