import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/db";
import { assetClasses, cmaSets, cmaSetValues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { seedCmaForFirm } from "@/lib/cma-seed-runner";
import { seedCmaSetsForFirm, mirrorActiveSetToAssetClasses, CMA_SET_KEYS } from "@/lib/cma-sets";

const firmId = "test-firm-cma-sets";

beforeEach(async () => {
  // clean slate for this firm
  const acs = await db.select({ id: assetClasses.id }).from(assetClasses).where(eq(assetClasses.firmId, firmId));
  await db.delete(assetClasses).where(eq(assetClasses.firmId, firmId)); // cascades cma_set_values
  await db.delete(cmaSets).where(eq(cmaSets.firmId, firmId));
  void acs;
});

describe("seedCmaSetsForFirm", () => {
  it("creates exactly 3 sets with historical active and a value row per set per asset class", async () => {
    await seedCmaForFirm(firmId); // 15 asset classes
    await seedCmaSetsForFirm(firmId);

    const sets = await db.select().from(cmaSets).where(eq(cmaSets.firmId, firmId));
    expect(sets.map((s) => s.key).sort()).toEqual([...CMA_SET_KEYS].sort());
    expect(sets.filter((s) => s.isActive).map((s) => s.key)).toEqual(["historical"]);

    const acs = await db.select({ id: assetClasses.id }).from(assetClasses).where(eq(assetClasses.firmId, firmId));
    for (const set of sets) {
      const vals = await db.select().from(cmaSetValues).where(eq(cmaSetValues.cmaSetId, set.id));
      expect(vals.length).toBe(acs.length);
    }
  });

  it("is idempotent", async () => {
    await seedCmaForFirm(firmId);
    await seedCmaSetsForFirm(firmId);
    await seedCmaSetsForFirm(firmId);
    const sets = await db.select().from(cmaSets).where(eq(cmaSets.firmId, firmId));
    expect(sets.length).toBe(3);
  });
});

describe("mirrorActiveSetToAssetClasses", () => {
  it("copies the active set's numbers onto asset_classes columns", async () => {
    await seedCmaForFirm(firmId);
    await seedCmaSetsForFirm(firmId);

    // make 'custom' active with a distinct number, then mirror
    const [custom] = await db.select().from(cmaSets).where(eq(cmaSets.key, "custom"));
    const [hist] = await db.select().from(cmaSets).where(eq(cmaSets.key, "historical"));
    const [oneVal] = await db.select().from(cmaSetValues).where(eq(cmaSetValues.cmaSetId, custom.id)).limit(1);
    await db.update(cmaSetValues).set({ geometricReturn: "0.0123" }).where(eq(cmaSetValues.id, oneVal.id));
    await db.update(cmaSets).set({ isActive: false }).where(eq(cmaSets.id, hist.id));
    await db.update(cmaSets).set({ isActive: true }).where(eq(cmaSets.id, custom.id));

    await mirrorActiveSetToAssetClasses(db, firmId);

    const [ac] = await db.select().from(assetClasses).where(eq(assetClasses.id, oneVal.assetClassId));
    expect(parseFloat(ac.geometricReturn)).toBeCloseTo(0.0123, 4);
  });
});
