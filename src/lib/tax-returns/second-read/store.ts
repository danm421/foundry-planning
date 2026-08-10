import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taxReturnState } from "@/db/schema";
import { MissingTaxReturnStateError } from "../errors";
import { secondReadSchema, SECOND_READ_VERSION, type SecondRead } from "./types";

/** Re-validate on every read, exactly as `parseRowFacts` does for facts. A
 *  blob that no longer satisfies the schema hides the PANEL; it must never
 *  take down the tab. */
export function parseStoredSecondRead(value: unknown): SecondRead | null {
  if (value == null) return null;
  const parsed = secondReadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/**
 * UPDATE-only, like `putOverrides`. Nothing in the request path may CREATE a
 * `tax_return_state` row — a return the backfill skipped has its figures only
 * in `tax_returns.facts`, and minting a state row here would let the next
 * `recomputeFacts` blank the year.
 *
 * `updatedAt` is set explicitly: the column has `.defaultNow()` but no
 * `$onUpdate`, so it does not advance by itself.
 */
export async function putSecondRead(
  taxReturnId: string,
  read: SecondRead,
  docHash: string,
): Promise<void> {
  const updated = await db
    .update(taxReturnState)
    .set({
      aiSecondRead: read,
      aiSecondReadDocHash: docHash,
      aiSecondReadVersion: SECOND_READ_VERSION,
      updatedAt: new Date(),
    })
    .where(eq(taxReturnState.taxReturnId, taxReturnId))
    .returning({ taxReturnId: taxReturnState.taxReturnId });
  if (updated.length === 0) throw new MissingTaxReturnStateError(taxReturnId);
}

/**
 * Flip one item's `dismissed` flag. Deliberately does NOT write the hash or
 * the version: dismissing is not regenerating, and rewriting either would make
 * a stale read report itself fresh.
 *
 * Returns the updated read, or null when there is nothing to dismiss — no
 * state row, no stored read, or an id that isn't in it. The route maps null to
 * a 404 rather than pretending the dismissal landed.
 */
export async function dismissSecondReadItem(
  taxReturnId: string,
  itemId: string,
): Promise<SecondRead | null> {
  const [row] = await db
    .select()
    .from(taxReturnState)
    .where(eq(taxReturnState.taxReturnId, taxReturnId))
    .limit(1);
  if (!row) return null;

  const read = parseStoredSecondRead(row.aiSecondRead);
  if (!read) return null;
  if (!read.items.some((item) => item.id === itemId)) return null;

  const next: SecondRead = {
    ...read,
    items: read.items.map((item) => (item.id === itemId ? { ...item, dismissed: true } : item)),
  };

  const updated = await db
    .update(taxReturnState)
    .set({ aiSecondRead: next, updatedAt: new Date() })
    .where(eq(taxReturnState.taxReturnId, taxReturnId))
    .returning({ taxReturnId: taxReturnState.taxReturnId });
  // The row existed for the SELECT above but is gone by the time this UPDATE
  // runs (e.g. the tax return was deleted mid-request) — same "nothing to
  // dismiss" condition as the earlier exits, so it gets the same null, not a
  // thrown error: the route maps null to a 404 either way.
  if (updated.length === 0) return null;

  return next;
}
