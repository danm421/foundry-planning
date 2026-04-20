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

export type AuditAction =
  | "client.delete"
  | "account.delete"
  | "liability.delete"
  | "income.delete"
  | "expense.delete"
  | "entity.delete"
  | "family_member.delete"
  | "deduction.delete"
  | "transfer.delete"
  | "asset_transaction.delete"
  | "savings_rule.delete"
  | "cma.asset_class.delete"
  | "cma.model_portfolio.delete";

type Args = {
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  clientId?: string | null;
  firmId: string;
  metadata?: Record<string, unknown>;
};

export async function recordAudit(args: Args): Promise<void> {
  try {
    const { userId } = await auth();
    await db.insert(auditLog).values({
      firmId: args.firmId,
      actorId: userId ?? "system",
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
