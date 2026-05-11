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
  // Accounts (balance-sheet line items)
  | "account.create"
  | "account.update"
  | "account.delete"
  | "account.allocation.update"
  | "account.reset_growth"
  // Liabilities
  | "liability.create"
  | "liability.update"
  | "liability.delete"
  | "extra_payment.create"
  | "extra_payment.update"
  | "extra_payment.delete"
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
  | "entity_flow_overrides.replace"
  | "trust_split_interest.create"
  | "trust_split_interest.update"
  | "family_member.create"
  | "family_member.update"
  | "family_member.delete"
  // Reports & comments
  | "report_comment.create"
  | "report_comment.update"
  // Reports v1 (PDF report builder)
  | "report.create"
  | "report.rename"
  | "report.delete"
  | "report.ai_generate"
  | "comparison_layout.upsert"
  // Document extraction (LLM call)
  | "client.extract"
  // Life insurance
  | "insurance_policy.create"
  | "insurance_policy.update"
  | "insurance_policy.delete"
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
  | "import.extraction.started"
  | "import.extraction.completed"
  | "import.extraction.failed"
  | "import.match.run"
  | "import.commit.tab"
  // Billing (Phase 1+ — written by webhook handlers and admin endpoints)
  | "billing.checkout_started"
  | "billing.subscription_created"
  | "billing.subscription_updated"
  | "billing.canceled"
  | "billing.addon_added"
  | "billing.addon_removed"
  | "billing.payment_failed"
  | "billing.payment_recovered"
  | "billing.email_queued"
  | "billing.dispute_created"
  // Org membership lifecycle (mirrors Clerk events)
  | "member.invited"
  | "member.removed"
  | "member.role_changed"
  // Firm-level lifecycle
  | "firm.name_changed"
  | "firm.archived"
  | "firm.founder_initialized";

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
    const actorId = args.actorId ?? (await auth()).userId ?? "system";
    await db.insert(auditLog).values({
      firmId: args.firmId,
      actorId,
      action: args.action,
      resourceType: args.resourceType,
      resourceId: args.resourceId,
      clientId: args.clientId ?? null,
      metadata: args.metadata ?? null,
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
