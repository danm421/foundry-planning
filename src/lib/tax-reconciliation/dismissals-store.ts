import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { taxReturnReconciliationDismissals as t } from "@/db/schema";
import { isUndefinedTable } from "@/lib/tax-returns/pg-errors";

export type DismissalsRead = { ok: true; ids: Set<string> } | { ok: false; unavailable: true };

/** Same posture as loadDocumentContext: exactly one failure — the table not
 *  existing yet — degrades; everything else propagates. */
export async function listDismissedIds(taxReturnId: string): Promise<DismissalsRead> {
  try {
    const rows = await db.select({ suggestionId: t.suggestionId }).from(t).where(eq(t.taxReturnId, taxReturnId));
    return { ok: true, ids: new Set(rows.map((r) => r.suggestionId)) };
  } catch (err) {
    if (isUndefinedTable(err)) return { ok: false, unavailable: true };
    throw err;
  }
}

export async function addDismissal(taxReturnId: string, suggestionId: string, dismissedBy: string | null): Promise<"ok" | "unavailable"> {
  try {
    await db.insert(t).values({ taxReturnId, suggestionId, dismissedBy }).onConflictDoNothing();
    return "ok";
  } catch (err) {
    if (isUndefinedTable(err)) return "unavailable";
    throw err;
  }
}

export async function removeDismissal(taxReturnId: string, suggestionId: string): Promise<"ok" | "unavailable"> {
  try {
    await db.delete(t).where(and(eq(t.taxReturnId, taxReturnId), eq(t.suggestionId, suggestionId)));
    return "ok";
  } catch (err) {
    if (isUndefinedTable(err)) return "unavailable";
    throw err;
  }
}
