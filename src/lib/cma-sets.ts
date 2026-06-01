import { db as defaultDb } from "@/db";
import { assetClasses, cmaSets, cmaSetValues } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import projected from "@/lib/cma-projected.generated.json";

export const CMA_SET_KEYS = ["historical", "projected", "custom"] as const;
export type CmaSetKey = (typeof CMA_SET_KEYS)[number];

export const CMA_SET_LABELS: Record<CmaSetKey, string> = {
  historical: "Historical",
  projected: "Projected",
  custom: "Custom",
};

type ProjectedClass = { name: string; slug?: string; geometricReturn: number; arithmeticMean: number; volatility: number };
const PROJECTED_BY_SLUG = new Map<string, ProjectedClass>();
const PROJECTED_BY_NAME = new Map<string, ProjectedClass>();
for (const c of projected.assetClasses as ProjectedClass[]) {
  if (c.slug) PROJECTED_BY_SLUG.set(c.slug, c);
  PROJECTED_BY_NAME.set(c.name, c);
}

type DbLike = typeof defaultDb;

/**
 * Copy the firm's active CMA set's numbers onto the asset_classes columns.
 * Single UPDATE … FROM. Safe to run inside or outside a transaction (pass tx).
 */
export async function mirrorActiveSetToAssetClasses(db: DbLike, firmId: string): Promise<void> {
  await db.execute(sql`
    UPDATE ${assetClasses} AS ac
    SET geometric_return = v.geometric_return,
        arithmetic_mean  = v.arithmetic_mean,
        volatility       = v.volatility,
        updated_at       = now()
    FROM ${cmaSetValues} AS v
    JOIN ${cmaSets} AS s ON s.id = v.cma_set_id
    WHERE v.asset_class_id = ac.id
      AND ac.firm_id = ${firmId}
      AND s.firm_id = ${firmId}
      AND s.is_active = true
  `);
}

/**
 * Idempotently ensure a firm has the 3 named sets and a value row per set per
 * asset class. Historical = current asset_classes numbers; Custom = clone of
 * Historical; Projected = cma-projected.generated.json (by slug, then name,
 * falling back to Historical). Historical is made active iff no set is active.
 */
export async function seedCmaSetsForFirm(firmId: string, db: DbLike = defaultDb): Promise<void> {
  // 1. Ensure the 3 set rows exist.
  await db
    .insert(cmaSets)
    .values(CMA_SET_KEYS.map((key, i) => ({ firmId, key, label: CMA_SET_LABELS[key], sortOrder: i })))
    .onConflictDoNothing({ target: [cmaSets.firmId, cmaSets.key] });

  const sets = await db.select().from(cmaSets).where(eq(cmaSets.firmId, firmId));
  const setByKey = new Map(sets.map((s) => [s.key as CmaSetKey, s]));

  // 2. Make historical active iff nothing is active.
  if (!sets.some((s) => s.isActive)) {
    const hist = setByKey.get("historical")!;
    await db.update(cmaSets).set({ isActive: true }).where(eq(cmaSets.id, hist.id));
  }

  // 3. Backfill value rows for any (set, asset class) pair that lacks one.
  const acs = await db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId));
  for (const set of sets) {
    const existing = await db
      .select({ assetClassId: cmaSetValues.assetClassId })
      .from(cmaSetValues)
      .where(eq(cmaSetValues.cmaSetId, set.id));
    const have = new Set(existing.map((e) => e.assetClassId));
    const toInsert = acs
      .filter((ac) => !have.has(ac.id))
      .map((ac) => {
        if (set.key === "projected") {
          const p = (ac.slug && PROJECTED_BY_SLUG.get(ac.slug)) || PROJECTED_BY_NAME.get(ac.name);
          if (p) {
            return {
              cmaSetId: set.id,
              assetClassId: ac.id,
              geometricReturn: String(p.geometricReturn),
              arithmeticMean: String(p.arithmeticMean),
              volatility: String(p.volatility),
            };
          }
        }
        // historical, custom, or projected-without-mapping → clone current columns
        return {
          cmaSetId: set.id,
          assetClassId: ac.id,
          geometricReturn: ac.geometricReturn,
          arithmeticMean: ac.arithmeticMean,
          volatility: ac.volatility,
        };
      });
    if (toInsert.length > 0) {
      await db.insert(cmaSetValues).values(toInsert).onConflictDoNothing({
        target: [cmaSetValues.cmaSetId, cmaSetValues.assetClassId],
      });
    }
  }
}
