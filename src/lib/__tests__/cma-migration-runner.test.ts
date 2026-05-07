import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db } from "@/db";
import {
  assetClasses,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClassCorrelations,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { seedCmaForFirm } from "../cma-seed-runner";
import {
  migrateFirmToStandard,
  buildPreviewForFirm,
  MigrationValidationError,
} from "../cma-migration-runner";

const testFirms: string[] = [];
function makeFirmId() {
  const id = `test_firm_${randomUUID()}`;
  testFirms.push(id);
  return id;
}

afterEach(async () => {
  for (const firmId of testFirms.splice(0)) {
    const firmClasses = await db
      .select({ id: assetClasses.id })
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    if (firmClasses.length > 0) {
      const ids = firmClasses.map((c) => c.id);
      await db
        .delete(assetClassCorrelations)
        .where(inArray(assetClassCorrelations.assetClassIdA, ids));
    }
    await db.delete(modelPortfolios).where(eq(modelPortfolios.firmId, firmId));
    await db.delete(assetClasses).where(eq(assetClasses.firmId, firmId));
  }
});

/** Insert a single legacy asset class for a firm to simulate a pre-migration
 *  firm seeded with the old defaults. */
async function insertLegacyClass(firmId: string, name: string) {
  const [row] = await db
    .insert(assetClasses)
    .values({
      firmId,
      name,
      geometricReturn: "0.05",
      arithmeticMean: "0.06",
      volatility: "0.10",
      pctOrdinaryIncome: "1",
      pctLtCapitalGains: "0",
      pctQualifiedDividends: "0",
      pctTaxExempt: "0",
      sortOrder: 99,
      assetType: "taxable_bonds",
    })
    .returning();
  return row;
}

describe("buildPreviewForFirm", () => {
  it("flags legacy classes as removed and lists missing standard classes as added", async () => {
    const firmId = makeFirmId();
    // Seed standard set first
    await seedCmaForFirm(firmId);
    // Add a legacy class on top
    await insertLegacyClass(firmId, "US Aggregate Bond");

    const preview = await buildPreviewForFirm(firmId);

    expect(preview.assetClasses.added).toEqual([]);
    expect(preview.assetClasses.removed.map((r) => r.name)).toEqual([
      "US Aggregate Bond",
    ]);
    expect(preview.assetClasses.removed[0].portfolioAllocCount).toBe(0);
    expect(preview.assetClasses.removed[0].accountAllocCount).toBe(0);
    expect(preview.correlationPairsToAdd).toBe(0);
  });

  it("counts portfolio allocations referencing the legacy class", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    const legacy = await insertLegacyClass(firmId, "Cash / Money Market");

    const [portfolio] = await db
      .insert(modelPortfolios)
      .values({ firmId, name: "Custom Mix", description: null })
      .returning();
    await db.insert(modelPortfolioAllocations).values({
      modelPortfolioId: portfolio.id,
      assetClassId: legacy.id,
      weight: "0.20",
    });

    const preview = await buildPreviewForFirm(firmId);
    const cash = preview.assetClasses.removed.find(
      (r) => r.name === "Cash / Money Market"
    );
    expect(cash?.portfolioAllocCount).toBe(1);
  });
});

describe("migrateFirmToStandard", () => {
  it("remaps a legacy class's portfolio allocations onto the new class and deletes the legacy", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    const legacy = await insertLegacyClass(firmId, "US Aggregate Bond");

    // Find an existing standard class to remap onto.
    const [tenYr] = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    const tenYrId = (
      await db
        .select()
        .from(assetClasses)
        .where(eq(assetClasses.firmId, firmId))
    ).find((c) => c.name === "10-year Treasury")!.id;

    const [portfolio] = await db
      .insert(modelPortfolios)
      .values({ firmId, name: "Test Mix", description: null })
      .returning();
    await db.insert(modelPortfolioAllocations).values({
      modelPortfolioId: portfolio.id,
      assetClassId: legacy.id,
      weight: "0.15",
    });

    const result = await migrateFirmToStandard(firmId, {
      remappings: { [legacy.id]: { kind: "remap", toClassName: "10-year Treasury" } },
    });

    expect(result.deletedAssetClasses).toBe(1);
    expect(result.remappedPortfolioAllocations).toBe(1);

    // Old class is gone.
    const stillThere = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.id, legacy.id));
    expect(stillThere).toHaveLength(0);

    // Portfolio allocation now points at the new class.
    const allocs = await db
      .select()
      .from(modelPortfolioAllocations)
      .where(eq(modelPortfolioAllocations.modelPortfolioId, portfolio.id));
    expect(allocs).toHaveLength(1);
    expect(allocs[0].assetClassId).toBe(tenYrId);
    expect(Number(allocs[0].weight)).toBeCloseTo(0.15, 4);

    // tenYr existed already (not a sanity blocker, just confirming we didn't
    // accidentally duplicate).
    void tenYr;
  });

  it("sums weights when both legacy and target appear in the same portfolio", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    const legacy = await insertLegacyClass(firmId, "US Aggregate Bond");
    const tenYrId = (
      await db
        .select()
        .from(assetClasses)
        .where(eq(assetClasses.firmId, firmId))
    ).find((c) => c.name === "10-year Treasury")!.id;

    const [portfolio] = await db
      .insert(modelPortfolios)
      .values({ firmId, name: "Collide Mix", description: null })
      .returning();
    await db.insert(modelPortfolioAllocations).values([
      { modelPortfolioId: portfolio.id, assetClassId: legacy.id, weight: "0.20" },
      { modelPortfolioId: portfolio.id, assetClassId: tenYrId, weight: "0.30" },
    ]);

    await migrateFirmToStandard(firmId, {
      remappings: { [legacy.id]: { kind: "remap", toClassName: "10-year Treasury" } },
    });

    const allocs = await db
      .select()
      .from(modelPortfolioAllocations)
      .where(eq(modelPortfolioAllocations.modelPortfolioId, portfolio.id));
    expect(allocs).toHaveLength(1);
    expect(allocs[0].assetClassId).toBe(tenYrId);
    expect(Number(allocs[0].weight)).toBeCloseTo(0.5, 4);
  });

  it("keeps a legacy class when kind=keep is requested", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    const legacy = await insertLegacyClass(firmId, "Cash / Money Market");

    const result = await migrateFirmToStandard(firmId, {
      remappings: { [legacy.id]: { kind: "keep" } },
    });

    expect(result.keptLegacy).toBe(1);
    expect(result.deletedAssetClasses).toBe(0);

    const stillThere = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.id, legacy.id));
    expect(stillThere).toHaveLength(1);
  });

  it("deletes an unused legacy class when kind=delete is requested", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    const legacy = await insertLegacyClass(firmId, "US Corporate Bond");

    const result = await migrateFirmToStandard(firmId, {
      remappings: { [legacy.id]: { kind: "delete" } },
    });

    expect(result.deletedAssetClasses).toBe(1);

    const stillThere = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.id, legacy.id));
    expect(stillThere).toHaveLength(0);
  });

  it("throws when delete is requested on an in-use class", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    const legacy = await insertLegacyClass(firmId, "US Aggregate Bond");

    const [portfolio] = await db
      .insert(modelPortfolios)
      .values({ firmId, name: "Locked Mix", description: null })
      .returning();
    await db.insert(modelPortfolioAllocations).values({
      modelPortfolioId: portfolio.id,
      assetClassId: legacy.id,
      weight: "0.10",
    });

    await expect(
      migrateFirmToStandard(firmId, {
        remappings: { [legacy.id]: { kind: "delete" } },
      })
    ).rejects.toBeInstanceOf(MigrationValidationError);
  });

  it("inserts every missing standard class (including Inflation) on a legacy-only firm", async () => {
    const firmId = makeFirmId();
    // Don't seed at all — manually insert just one legacy class.
    const legacy = await insertLegacyClass(firmId, "US Aggregate Bond");

    const result = await migrateFirmToStandard(firmId, {
      remappings: { [legacy.id]: { kind: "keep" } },
    });

    // All 15 standard classes (14 + Inflation) added.
    expect(result.addedAssetClasses).toBe(15);

    const all = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    // 15 standard + 1 legacy kept = 16
    expect(all).toHaveLength(16);
    expect(all.find((c) => c.name === "US Large Cap")).toBeDefined();
    expect(all.find((c) => c.name === "Inflation")).toBeDefined();
    expect(all.find((c) => c.name === "US Aggregate Bond")).toBeDefined();
  });

  it("backfills Inflation when the firm has every other standard class but lacks it", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);
    // Simulate a firm seeded before Inflation existed by deleting it.
    await db
      .delete(assetClasses)
      .where(and(eq(assetClasses.firmId, firmId), eq(assetClasses.name, "Inflation")));

    const result = await migrateFirmToStandard(firmId, { remappings: {} });

    expect(result.addedAssetClasses).toBe(1);
    const all = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    expect(all.find((c) => c.name === "Inflation")).toBeDefined();
  });
});
