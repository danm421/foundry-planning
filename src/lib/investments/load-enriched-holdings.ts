import { db } from "@/db";
import { accountHoldings, holdingAssetClassOverrides, securityAssetClassWeights } from "@/db/schema";
import { asc, inArray } from "drizzle-orm";

export type RawHoldingRow = typeof accountHoldings.$inferSelect;

export interface EnrichedHoldingRow extends RawHoldingRow {
  securityWeights: { slug: string; weight: number }[];
  overrides: { assetClassId: string; weight: number }[];
  needsReview: boolean;
}

/** Pure: attach each row's security slug-blend + override blend, and flag rows
 *  that nothing classifies (no security weights AND no overrides → would fall
 *  entirely to the inflation residual). Kept pure for unit testing. */
export function enrichHoldingRows(
  rows: readonly RawHoldingRow[],
  weightsBySecurity: ReadonlyMap<string, { slug: string; weight: number }[]>,
  overridesByHolding: ReadonlyMap<string, { assetClassId: string; weight: number }[]>,
): EnrichedHoldingRow[] {
  return rows.map((r) => {
    const securityWeights = r.securityId ? weightsBySecurity.get(r.securityId) ?? [] : [];
    const overrides = overridesByHolding.get(r.id) ?? [];
    return {
      ...r,
      securityWeights,
      overrides,
      needsReview: securityWeights.length === 0 && overrides.length === 0,
    };
  });
}

/** Load enriched holdings for a set of accounts in one batched pass, grouped by
 *  account id. Accounts with no holdings are simply absent from the map. */
export async function loadEnrichedHoldings(
  accountIds: readonly string[],
): Promise<Map<string, EnrichedHoldingRow[]>> {
  const byAccount = new Map<string, EnrichedHoldingRow[]>();
  if (accountIds.length === 0) return byAccount;

  const rows = await db
    .select()
    .from(accountHoldings)
    .where(inArray(accountHoldings.accountId, [...accountIds]))
    .orderBy(asc(accountHoldings.sortOrder), asc(accountHoldings.createdAt));

  const holdingIds = rows.map((r) => r.id);
  const securityIds = Array.from(
    new Set(rows.map((r) => r.securityId).filter((s): s is string => s != null)),
  );

  const [overrideRows, weightRows] = await Promise.all([
    holdingIds.length
      ? db.select().from(holdingAssetClassOverrides)
          .where(inArray(holdingAssetClassOverrides.holdingId, holdingIds))
      : [],
    securityIds.length
      ? db.select().from(securityAssetClassWeights)
          .where(inArray(securityAssetClassWeights.securityId, securityIds))
      : [],
  ]);

  const weightsBySecurity = new Map<string, { slug: string; weight: number }[]>();
  for (const w of weightRows) {
    const list = weightsBySecurity.get(w.securityId) ?? [];
    list.push({ slug: w.assetClassSlug, weight: parseFloat(w.weight) });
    weightsBySecurity.set(w.securityId, list);
  }
  const overridesByHolding = new Map<string, { assetClassId: string; weight: number }[]>();
  for (const o of overrideRows) {
    const list = overridesByHolding.get(o.holdingId) ?? [];
    list.push({ assetClassId: o.assetClassId, weight: parseFloat(o.weight) });
    overridesByHolding.set(o.holdingId, list);
  }

  for (const e of enrichHoldingRows(rows, weightsBySecurity, overridesByHolding)) {
    const list = byAccount.get(e.accountId) ?? [];
    list.push(e);
    byAccount.set(e.accountId, list);
  }
  return byAccount;
}
