import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { modelPortfolios } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { tagSeedPortfolioRiskLevels } from "@/lib/cma/tag-seed-risk-levels";

const FIRM = `test-tag-${Date.now()}`;
afterEach(async () => {
  await db.delete(modelPortfolios).where(eq(modelPortfolios.firmId, FIRM));
});

async function riskOf(name: string) {
  const [r] = await db
    .select({ riskLevel: modelPortfolios.riskLevel })
    .from(modelPortfolios)
    .where(and(eq(modelPortfolios.firmId, FIRM), eq(modelPortfolios.name, name)));
  return r?.riskLevel ?? null;
}

describe("tagSeedPortfolioRiskLevels", () => {
  it("tags exact seed names, skips renamed, is idempotent, and respects a taken rung", async () => {
    await db.insert(modelPortfolios).values([
      { firmId: FIRM, name: "Conservative (30/70)" },
      { firmId: FIRM, name: "Balanced (60/40)" },
      { firmId: FIRM, name: "My Custom Sleeve" }, // renamed away — untouched
    ]);

    const tagged = await tagSeedPortfolioRiskLevels(db, FIRM);
    expect(tagged).toBe(2);
    expect(await riskOf("Conservative (30/70)")).toBe("conservative");
    expect(await riskOf("Balanced (60/40)")).toBe("moderate");
    expect(await riskOf("My Custom Sleeve")).toBeNull();

    // Idempotent
    expect(await tagSeedPortfolioRiskLevels(db, FIRM)).toBe(0);

    // A rung already taken by a manual tag is not double-assigned
    await db.insert(modelPortfolios).values({
      firmId: FIRM,
      name: "Growth (80/20)",
    });
    await db
      .update(modelPortfolios)
      .set({ riskLevel: "moderately_aggressive" })
      .where(and(eq(modelPortfolios.firmId, FIRM), eq(modelPortfolios.name, "My Custom Sleeve")));
    // Growth's rung (moderately_aggressive) is now taken by the custom sleeve →
    // Growth stays null rather than colliding.
    expect(await tagSeedPortfolioRiskLevels(db, FIRM)).toBe(0);
    expect(await riskOf("Growth (80/20)")).toBeNull();
  });
});
