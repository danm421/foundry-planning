import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { auditLog } from "@/db/schema";
import { snapshotActorName } from "./audit/actor-name";

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
  // Tax-only income adjustments (completed Roth conversions, banked bonuses, K-1s)
  | "tax_adjustment.create"
  | "tax_adjustment.update"
  | "tax_adjustment.delete"
  // Tax return analysis (AI-extracted 1040 facts)
  | "tax_return.extract"
  | "tax_return.update"
  | "tax_return.delete"
  | "tax_return.export_pdf"
  | "tax_return.document_add"
  | "tax_return.document_remove"
  | "tax_return.second_read"
  | "tax_return.second_read_dismiss"
  | "tax_reconciliation.apply"
  | "tax_reconciliation.dismiss"
  | "tax_reconciliation.restore"
  // Scenario-level movements
  | "transfer.create"
  | "transfer.update"
  | "transfer.delete"
  | "reinvestment.create"
  | "reinvestment.update"
  | "reinvestment.delete"
  // Investment proposals (current-vs-proposed portfolio comparisons)
  | "investment_proposal.create"
  | "investment_proposal.update"
  | "investment_proposal.delete"
  | "relocation.create"
  | "relocation.update"
  | "relocation.delete"
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
  // Annuities
  | "account.annuity.update"
  // Life insurance
  | "insurance_policy.create"
  | "insurance_policy.update"
  | "insurance_policy.delete"
  | "life_insurance_solver_settings.update"
  // Disability insurance (client-level policies, not scenario-scoped)
  | "disability_policy.create"
  | "disability_policy.update"
  | "disability_policy.delete"
  // CMA (firm-level, admin-gated)
  | "cma.asset_class.create"
  | "cma.asset_class.update"
  | "cma.asset_class.delete"
  | "cma.model_portfolio.create"
  | "cma.model_portfolio.update"
  | "cma.model_portfolio.delete"
  | "cma.model_portfolio.allocation.update"
  | "cma.model_portfolio.detach"
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
  | "cma.ticker_portfolio.promote"
  | "cma.settings.update"
  // Open items (client-scoped to-do / data-gathering tracker)
  | "open_item.create"
  | "open_item.update"
  | "open_item.complete"
  | "open_item.delete"
  // Plan observations & next steps (client-scoped advisor notes panel)
  | "plan_observation.create"
  | "plan_observation.update"
  | "plan_observation.complete"
  | "plan_observation.delete"
  | "plan_observation.reorder"
  | "plan_observation.clear_ai"
  | "plan_observation_context.update"
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
  | "import.assemble.run"
  | "import.assemble.answered"
  | "import.commit.tab"
  // Rebalance — reading holdings off a statement for an outside portfolio.
  // Nothing is persisted, so this audit row is the only record the read happened.
  | "rebalance.holdings.extracted"
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
  // Self-serve signup: the buyer's firm provisioned, but pinning them to
  // org:admin failed. Non-fatal by design (the webhook still returns 200), so
  // this row is the only durable trace that someone is stranded at the retired
  // org:owner role and will be 403'd on firm config and team invites.
  | "billing.org_role_pin_failed"
  // Ops console (cross-org staff actions; actorId = ops user, firmId = target)
  | "ops.entitlement.granted"
  | "ops.entitlement.revoked"
  | "ops.user_entitlement.granted"
  | "ops.user_entitlement.revoked"
  | "ops.billing.portal_opened"
  | "ops.billing.trial_extended"
  | "ops.impersonation.started"
  | "ops.impersonation.ended"
  // Who holds ops access (firmId = "system"; these are not scoped to a firm)
  | "ops.admin.added"
  | "ops.admin.updated"
  // Org membership lifecycle (mirrors Clerk events)
  | "member.invited"
  | "member.removed"
  | "member.role_changed"
  // Firm-level lifecycle
  | "firm.name_changed"
  | "firm.book_silo_changed"
  | "firm.archived"
  | "firm.purged"
  | "firm.founder_initialized"
  | "beta_code.redeemed"
  | "beta_code.minted"
  | "beta_code.revoked"
  // Checkout discounts. The objects live in Stripe; these rows are the only
  // record of which operator created or killed one, and on what terms.
  | "promo_code.created"
  | "promo_code.deactivated"
  | "firm.branding_logo_changed"
  | "firm.branding_favicon_changed"
  | "firm.branding_color_changed"
  // Per-advisor branding (self edit gated by grant, admin override)
  | "advisor_branding.update"
  | "advisor_branding.grant"
  // Advisor logo/favicon upload or removal (blob asset, not a field edit).
  // metadata carries { kind, before, after } — blob URLs, not personal data.
  | "advisor_branding.asset_changed"
  // CRM (lightweight household / contact / account records that may or
  // may not be linked to a planning client).
  | "crm.household.create"
  | "crm.household.update"
  | "crm.household.delete"
  | "crm.household.soft_delete"
  | "crm.household.restore"
  | "crm.household_relationship.create"
  | "crm.household_relationship.delete"
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
  | "crm.meeting_prep.export"
  // CRM Tasks
  | "crm.task.create"
  | "crm.task.update"
  | "crm.task.delete"
  | "crm.task.status_changed"
  | "crm.task.comment"
  | "crm.task.file_uploaded"
  | "crm.task.file_deleted"
  | "crm.task.file_downloaded"
  | "crm.tag.create"
  // CRM Notes (view over crm_activity)
  | "crm.note.create"
  | "crm.note.update"
  | "crm.note.delete"
  // Divorce planning (draft workbench — settings/allocations live on one
  // draft row per client; abandon retires it without deleting history)
  | "divorce_plan.create"
  | "divorce_plan.update"
  | "divorce_plan.abandon"
  | "divorce_plan.commit"
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
  | "vault.document.download"
  // Support & feedback
  | "support.message_sent"
  // Cross-org sharing (share grants and revocations)
  | "client_share.create"
  | "client_share.revoke"
  // Planning Forge (LLM agent). New writes emit forge.*; the copilot.* variants
  // are LEGACY — rows written before the 2026-06-17 copilot→Forge rename cutover.
  // They remain in the union so historical audit rows still type-check/decode;
  // they are NOT backfilled (the audit log is append-only/immutable).
  | "forge.query" // a user turn was submitted to Forge
  | "forge.tool_call" // the agent invoked a read/compute/write tool
  | "forge.write_proposed" // a write tool produced a preview, awaiting approval
  | "forge.write_approved" // the advisor confirmed a proposed write (executed)
  | "forge.write_rejected" // the advisor rejected a proposed write
  | "forge.undo" // the advisor reverted the conversation to a prior checkpoint
  | "copilot.query" // legacy (pre-2026-06-17 cutover)
  | "copilot.tool_call" // legacy
  | "copilot.write_proposed" // legacy
  | "copilot.write_approved" // legacy
  | "copilot.write_rejected" // legacy
  | "feedback.submitted"
  // Integration providers (Orion, Schwab)
  | "integration.connect"
  | "integration.disconnect"
  | "integration.recheck" // an admin re-verified stored credentials
  | "integration.sync"
  | "integration.household.claim" // an advisor claimed a household by id
  | "integration.household.link" // an admin linked a household from the table
  | "integration.household.unlink"
  // Client portal
  | "portal.invite.sent"
  | "portal.invite.revoked"
  | "portal.access.disabled"
  | "portal.edit_toggle"
  | "portal.feature_toggle"
  | "portal.family.create"
  | "portal.family.update"
  | "portal.family.delete"
  | "portal.trust.update"
  | "portal.household.update"
  | "portal.invite.accepted"
  | "portal.account.create"
  | "portal.account.update"
  | "portal.account.delete"
  | "portal.liability.create"
  | "portal.liability.update"
  | "portal.liability.delete"
  | "portal.plaid.link"
  | "portal.plaid.refresh"
  | "portal.plaid.sync"
  | "portal.plaid.unlink"
  | "portal.plaid.account_detach"
  | "portal.plaid.reauth"
  | "portal.plaid.dismiss_new_accounts"
  // Plaid webhooks (background sync/refresh; actorKind "system", no advisor
  // or client in the loop)
  | "webhook.plaid.sync"
  | "webhook.plaid.refresh"
  // Intake / data-collection forms
  | "intake.form.sent"
  | "intake.form.submitted"
  | "intake.form.applied"
  | "intake.form.discarded"
  | "intake.form.revoked"
  // Public-link identity gate: a failed attempt is the signal that someone is
  // guessing against a live link, so it is audited as well as rate-limited.
  | "intake.form.verified"
  | "intake.form.verify_failed"
  | "intake.email_settings.update"
  // Phase 4 — spending transactions / categorization
  | "portal.transaction.create"
  | "portal.transaction.update"
  | "portal.transaction.review_all"
  | "portal.transaction.review_batch"
  | "portal.transaction.delete"
  | "portal.rule.create"
  | "portal.rule.update"
  | "portal.rule.delete"
  | "portal.category.create"
  | "portal.category.update"
  | "portal.category.delete"
  | "portal.budget.update"
  | "portal.recurring.create"
  | "portal.recurring.update"
  | "portal.recurring.delete"
  // Portal privacy (advisor-sharing switches)
  | "portal.privacy.update"
  // Portal document vault (client-uploaded shared documents)
  | "portal.document.create"
  | "portal.document.update"
  | "portal.document.delete"
  | "portal.folder.create"
  | "portal.folder.update"
  | "portal.folder.delete"
  // Risk profiles
  | "risk_profile.tolerance_manual"
  | "risk_profile.environment_changed"
  | "risk_profile.rtq_completed"
  | "risk_profile.portfolio_applied"
  | "risk_profile.rtq_sent"
  | "risk_profile.export_pdf"
  // Notifications ("Alerts")
  | "notification.preferences.update"
  // Advisor first-run onboarding (Task 2: lazy row creation; Task 3 adds
  // advisor_onboarding.start / advisor_onboarding.dismiss for the route)
  | "advisor_onboarding.create"
  | "advisor_onboarding.start"
  | "advisor_onboarding.dismiss"
  // Intake document uploads (public client-facing path, no Clerk session)
  | "intake.document.uploaded"
  | "intake.document.deleted"
  // Plan Story (AI-narrated chapters for the client-facing plan PDF).
  // `generated` is one run over every chapter of one scenario; every other
  // action here is per chapter. Generation is advisor-triggered from the
  // review panel and makes model calls, so it is audited like the other LLM
  // actions above.
  | "plan_story.generated"
  | "plan_story.chapter_edited"
  | "plan_story.chapter_reviewed"
  // The advisor's undo for `chapter_reviewed` — a mis-click, or a second look
  // that changes their mind. Its own action rather than folded into a second
  // `chapter_reviewed` row: an audit trail that could not tell "reviewed" from
  // "un-reviewed" apart would read as a chapter that was approved when the
  // last thing that happened to it was the opposite.
  | "plan_story.chapter_unreviewed"
  // …and its own action rather than an edit, because it is the one thing in
  // this feature that THROWS AWAY words a human wrote: the advisor is letting a
  // rewrite their own version was standing in front of through, and their
  // version does not survive it.
  | "plan_story.generated_accepted"
  // The soft export gate: a deck went out with chapters nobody has read. Not a
  // refusal — the spec's decision is to warn, never block — so this row is the
  // whole of the control: the evidence that review happened (or didn't) for a
  // client-facing document that carries no "AI-generated" marker of its own.
  | "plan_story.exported_unreviewed"
  // Plan Story voice — the advisor's style note and the writing samples the
  // model is shown. Audited because every ENABLED sample is sent to the model
  // while writing OTHER households' reports, so who added one, and who switched
  // it on, is the evidence trail for how a client's report came to read the way
  // it does. `sample_enabled` covers switching a sample OFF as well and carries
  // the new state in metadata, the same shape as `scenario_change.set_enabled`.
  | "story_voice.profile_updated"
  | "story_voice.sample_added"
  | "story_voice.sample_enabled"
  | "story_voice.sample_deleted";

// Drizzle transaction handle — same convention as src/lib/clients/create-client.ts.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DbOrTx = typeof db | Tx;

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
  // 'advisor' (default) for staff edits, 'client' for portal edits,
  // 'system' for unattended jobs (webhooks, crons).
  actorKind?: "advisor" | "client" | "system";
  // Write the row on a caller's open transaction instead of the module-level `db`.
  // Additive and optional: every existing call site keeps today's behaviour.
  //
  // An audit row is a claim that a change happened. When the change itself is running
  // inside a caller's transaction, a row written on a separate pooled connection
  // commits even if that transaction rolls back — leaving the log permanently
  // asserting an edit that never landed. Passing the handle makes the row atomic with
  // the change it describes.
  tx?: DbOrTx;
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
    // Snapshot the actor's display name so the row keeps its author even after
    // that user leaves the org. Best-effort — never blocks the insert.
    const actorName = await snapshotActorName(actorId);
    if (actorName) metadata = { ...(metadata ?? {}), actorName };
    const row = {
      firmId: args.firmId,
      actorId,
      actorKind: args.actorKind ?? "advisor",
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      clientId: args.clientId ?? null,
      metadata,
    };
    if (args.tx) {
      // Inside a caller's transaction the row must live and die with the write it
      // describes — but it must not be able to KILL that write. A failed INSERT aborts
      // the whole Postgres transaction (25P02) and every later statement with it, which
      // would invert this function's fail-soft contract for tx callers only.
      //
      // A nested transaction is a real SAVEPOINT on this driver: drizzle's pg dialect
      // issues `savepoint spN` on the SAME session and `rollback to savepoint spN` if the
      // callback throws (drizzle-orm/neon-serverless/session.js:198-209). So an audit
      // failure rolls back only itself, the enclosing transaction stays usable, and the
      // catch below swallows it exactly as it does on the plain path.
      await args.tx.transaction(async (sp) => { await sp.insert(auditLog).values(row); });
    } else {
      await db.insert(auditLog).values(row);
    }
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
