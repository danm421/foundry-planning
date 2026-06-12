import { db } from "@/db";
import {
  accounts, clients, accountHoldings, accountAssetAllocations,
  holdingAssetClassOverrides, securityAssetClassWeights, assetClasses,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { rollupHoldings, firmSlugToAssetClassId, type HoldingInput } from "./holdings-rollup";

/**
 * Roll an account's holdings into its asset mix. When the account is driven by
 * its holdings (deriveFromHoldings !== false), this REPLACES
 * account_asset_allocations with the value-weighted rollup and forces
 * growthSource to "asset_mix" so the projection engine reads the blend through
 * the normal asset_mix path. No-op when deriveFromHoldings is false.
 *
 * Firm scoping is the caller's responsibility (the holdings routes already
 * assert account-in-firm before calling this). Runs in base mode only —
 * holdings editing is base-mode-only, matching the existing allocations gap.
 */
export async function syncAccountFromHoldings(accountId: string): Promise<void> {
  const [acct] = await db
    .select({
      deriveFromHoldings: accounts.deriveFromHoldings,
      firmId: clients.firmId,
    })
    .from(accounts)
    .innerJoin(clients, eq(clients.id, accounts.clientId))
    .where(eq(accounts.id, accountId));
  if (!acct || acct.deriveFromHoldings === false) return;

  const holdingRows = await db
    .select()
    .from(accountHoldings)
    .where(eq(accountHoldings.accountId, accountId));

  // Build the slug→assetClassId map scoped to THIS account's firm. Slugs are
  // unique per firm but shared across firms (every firm seeds us_large_cap,
  // reit, …); loading every firm's classes would collapse the slugs and could
  // resolve to a foreign firm's id, which then reads as 0% in the firm-scoped
  // Asset Mix editor. firmSlugToAssetClassId filters by firmId as a backstop.
  const acRows = await db
    .select({ id: assetClasses.id, slug: assetClasses.slug, firmId: assetClasses.firmId })
    .from(assetClasses)
    .where(eq(assetClasses.firmId, acct.firmId));
  const slugToAssetClassId = firmSlugToAssetClassId(acRows, acct.firmId);

  const holdingIds = holdingRows.map((h) => h.id);
  const securityIds = Array.from(
    new Set(holdingRows.map((h) => h.securityId).filter((s): s is string => s != null)),
  );
  const [overrideRows, weightRows] = await Promise.all([
    holdingIds.length
      ? db.select().from(holdingAssetClassOverrides)
          .where(inArray(holdingAssetClassOverrides.holdingId, holdingIds))
      : Promise.resolve([]),
    securityIds.length
      ? db.select().from(securityAssetClassWeights)
          .where(inArray(securityAssetClassWeights.securityId, securityIds))
      : Promise.resolve([]),
  ]);

  const overridesByHolding = new Map<string, { assetClassId: string; weight: number }[]>();
  for (const o of overrideRows) {
    const list = overridesByHolding.get(o.holdingId) ?? [];
    list.push({ assetClassId: o.assetClassId, weight: parseFloat(o.weight) });
    overridesByHolding.set(o.holdingId, list);
  }
  const weightsBySecurity = new Map<string, { slug: string; weight: number }[]>();
  for (const w of weightRows) {
    const list = weightsBySecurity.get(w.securityId) ?? [];
    list.push({ slug: w.assetClassSlug, weight: parseFloat(w.weight) });
    weightsBySecurity.set(w.securityId, list);
  }

  const inputs: HoldingInput[] = holdingRows.map((h) => ({
    id: h.id,
    securityId: h.securityId,
    shares: parseFloat(h.shares),
    price: parseFloat(h.price),
    costBasis: parseFloat(h.costBasis),
    marketValue: h.marketValue != null ? parseFloat(h.marketValue) : null,
    securityWeights: h.securityId ? weightsBySecurity.get(h.securityId) ?? [] : [],
    overrides: overridesByHolding.get(h.id) ?? [],
  }));

  const rollup = rollupHoldings(inputs, slugToAssetClassId);

  await db.transaction(async (tx) => {
    await tx
      .delete(accountAssetAllocations)
      .where(eq(accountAssetAllocations.accountId, accountId));
    if (rollup.allocations.length > 0) {
      await tx.insert(accountAssetAllocations).values(
        rollup.allocations.map((a) => ({
          accountId,
          assetClassId: a.assetClassId,
          weight: String(a.weight),
        })),
      );
    }
    await tx
      .update(accounts)
      .set({ growthSource: "asset_mix", updatedAt: new Date() })
      .where(eq(accounts.id, accountId));
  });
}
