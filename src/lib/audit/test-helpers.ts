import { beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

/**
 * Register hooks that delete any `audit_log` rows a DB-backed test file creates
 * for `clientId`, so tests stop leaking audit history onto shared seed clients
 * (e.g. the Cooper sample) with test-fixture / org-ID actors that render as
 * "Former member".
 *
 * How: snapshot the client's audit-row IDs in `beforeAll`, then in `afterAll`
 * delete every row for that client that wasn't in the snapshot. This is
 * complete regardless of the actor and of whether the domain row was tracked —
 * it catches create-then-delete cases that per-resource cleanup misses.
 *
 * MUST be called inside a DB-gated `describe` block (so the hooks are skipped,
 * and never touch the DB, when `DATABASE_URL` is absent).
 */
export function sweepLeakedAuditRows(clientId: string): void {
  let baseline = new Set<string>();

  beforeAll(async () => {
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.clientId, clientId));
    baseline = new Set(rows.map((r) => r.id));
  });

  afterAll(async () => {
    const rows = await db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.clientId, clientId));
    const leaked = rows.map((r) => r.id).filter((id) => !baseline.has(id));
    if (leaked.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.id, leaked));
    }
  });
}
