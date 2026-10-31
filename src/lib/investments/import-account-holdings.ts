import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accountHoldings } from "@/db/schema";
import { normalizeExtractedHolding } from "@/lib/extraction/normalize-holdings";
import { holdingRow, resolveTickers } from "@/lib/imports/commit/holdings";
import type { HoldingsImportMode, ImportHolding } from "./holdings-import";
import { syncAccountFromHoldings } from "./sync-account-from-holdings";

/**
 * Write imported positions onto one account — the Holdings tab's import, from a
 * spreadsheet or a statement. Rows are built exactly as the import wizard
 * builds them (`holdingRow`: a classified ticker takes a live price, anything
 * else keeps its stated value). `replace` clears the account's positions
 * first; `append` adds after them. Scoping is the caller's: the route has
 * already asserted the account belongs to a client it may edit.
 */
export async function importAccountHoldings(
  accountId: string,
  holdings: readonly ImportHolding[],
  mode: HoldingsImportMode,
): Promise<void> {
  // Normalized, as `holdingRow` reads it: a cash line's ticker is no ticker.
  const tickers = new Set(
    holdings.flatMap((h) => normalizeExtractedHolding(h).ticker ?? []),
  );
  const resolved = await resolveTickers([...tickers]);

  await db.transaction(async (tx) => {
    let start = 0;
    if (mode === "replace") {
      await tx.delete(accountHoldings).where(eq(accountHoldings.accountId, accountId));
    } else {
      const [{ last }] = await tx
        .select({ last: sql`coalesce(max(${accountHoldings.sortOrder}), -1)`.mapWith(Number) })
        .from(accountHoldings)
        .where(eq(accountHoldings.accountId, accountId));
      start = last + 1;
    }
    await tx
      .insert(accountHoldings)
      .values(holdings.map((h, i) => holdingRow(accountId, h, resolved, start + i)));
  });

  await syncAccountFromHoldings(accountId);
}
