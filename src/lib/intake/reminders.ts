import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

/**
 * When each form was last nudged, keyed by form id. Forms never reminded are
 * simply absent.
 *
 * Read from the audit log rather than a column on `intake_forms`: the reminder
 * already writes an audit row for SOC-2, and `updated_at` can't stand in for it
 * — a client autosaving their draft touches that on every keystroke.
 *
 * `DISTINCT ON` rather than `max(created_at)`: an aggregate escapes Drizzle's
 * timestamp mapping and comes back as a naive string, which `new Date()` would
 * then read as local time — an hours-wrong date on the exact line whose job is
 * to say "you already chased them today". `DISTINCT ON` returns the real
 * column, so the mapping still applies, and it hands back one row per form
 * instead of every reminder ever sent (3/day for up to the 30-day token life).
 */
export async function loadLastRemindedAt(
  firmId: string,
  formIds: string[],
): Promise<Record<string, Date>> {
  if (formIds.length === 0) return {};

  const rows = await db
    .selectDistinctOn([auditLog.resourceId], {
      resourceId: auditLog.resourceId,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.firmId, firmId),
        eq(auditLog.action, "intake.form.reminded"),
        eq(auditLog.resourceType, "intake_form"),
        inArray(auditLog.resourceId, formIds),
      ),
    )
    // DISTINCT ON keeps the first row of each `resourceId` group, so the
    // ordering is what picks the newest — it must lead with the same column.
    .orderBy(auditLog.resourceId, desc(auditLog.createdAt));

  return Object.fromEntries(rows.map((r) => [r.resourceId, r.createdAt]));
}
