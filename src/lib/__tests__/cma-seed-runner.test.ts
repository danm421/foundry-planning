import { describe, it, expect, afterEach } from "vitest";
import { randomUUID } from "crypto";
import { db } from "@/db";
import {
  assetClasses,
  modelPortfolios,
  modelPortfolioAllocations,
  assetClassCorrelations,
} from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { seedCmaForFirm } from "../cma-seed-runner";

// Each test uses a fresh firmId so parallel runs / re-runs don't collide.
const testFirms: string[] = [];
function makeFirmId() {
  const id = `test_firm_${randomUUID()}`;
  testFirms.push(id);
  return id;
}

afterEach(async () => {
  for (const firmId of testFirms.splice(0)) {
    // Delete correlations first (FK to asset_classes) — cascade handles it,
    // but explicit cleanup is clearer.
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

describe("seedCmaForFirm", () => {
  it("seeds 15 asset classes, 4 portfolios, 36 allocations, 91 correlations on empty firm", async () => {
    const firmId = makeFirmId();

    const result = await seedCmaForFirm(firmId);

    // Totals (rows now present) and inserts (rows added by this call) both
    // equal the defaults on an empty firm.
    expect(result.assetClasses).toBe(15);
    expect(result.portfolios).toBe(4);
    expect(result.correlations).toBe(91);
    expect(result.inserted.assetClasses).toBe(15);
    expect(result.inserted.portfolios).toBe(4);
    expect(result.inserted.allocations).toBe(36);
    expect(result.inserted.correlations).toBe(91);

    const rows = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    expect(rows).toHaveLength(15);
  });

  it("is idempotent — second call does not duplicate rows", async () => {
    const firmId = makeFirmId();

    await seedCmaForFirm(firmId);
    await seedCmaForFirm(firmId);

    const classes = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    expect(classes).toHaveLength(15);

    const portfolios = await db
      .select()
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId));
    expect(portfolios).toHaveLength(4);

    const allocs = await db
      .select({ id: modelPortfolioAllocations.id })
      .from(modelPortfolioAllocations)
      .innerJoin(
        modelPortfolios,
        eq(modelPortfolioAllocations.modelPortfolioId, modelPortfolios.id)
      )
      .where(eq(modelPortfolios.firmId, firmId));
    expect(allocs).toHaveLength(36);
  });

  it("fills in missing portfolios when asset classes already exist", async () => {
    const firmId = makeFirmId();

    // Pre-seed only asset classes by calling the helper then deleting portfolios.
    await seedCmaForFirm(firmId);
    await db.delete(modelPortfolios).where(eq(modelPortfolios.firmId, firmId));

    // Calling again should re-create portfolios + allocations without
    // touching the existing asset classes.
    await seedCmaForFirm(firmId);

    const portfolios = await db
      .select()
      .from(modelPortfolios)
      .where(eq(modelPortfolios.firmId, firmId));
    expect(portfolios).toHaveLength(4);

    const classes = await db
      .select()
      .from(assetClasses)
      .where(eq(assetClasses.firmId, firmId));
    expect(classes).toHaveLength(15);
  });

  it("reports zero inserts when firm is already fully seeded", async () => {
    const firmId = makeFirmId();
    await seedCmaForFirm(firmId);

    const second = await seedCmaForFirm(firmId);

    expect(second.inserted.assetClasses).toBe(0);
    expect(second.inserted.portfolios).toBe(0);
    expect(second.inserted.allocations).toBe(0);
    expect(second.inserted.correlations).toBe(0);
    // Totals are still the full defaults.
    expect(second.assetClasses).toBe(15);
    expect(second.portfolios).toBe(4);
    expect(second.correlations).toBe(91);
  });
});
