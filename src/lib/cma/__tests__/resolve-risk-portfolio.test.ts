// src/lib/cma/__tests__/resolve-risk-portfolio.test.ts
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { clients, crmHouseholds, modelPortfolios, planSettings, scenarios } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  resolveRiskPortfolioId,
  applyRiskPortfolioToScenario,
} from "@/lib/cma/resolve-risk-portfolio";

const FIRM = `test-risk-${Date.now()}`;

/**
 * No `seedClientWithScenario()` live-DB harness exists anywhere in `src/`
 * (confirmed by grep; see the DEFECT-1 comment in
 * `src/lib/imports/commit/__tests__/goals.test.ts`, which hit the same gap).
 * Other live-DB suites (`src/lib/home/__tests__/book-breakdown.db.test.ts`,
 * `src/lib/clients/create-client.ts`) insert `crm_households` -> `clients` ->
 * `scenarios` -> `plan_settings` directly, so this follows that precedent
 * rather than inventing an import that doesn't exist.
 */
async function seedClientWithScenario(firmId: string): Promise<{ scenarioId: string }> {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "adv-risk-test", name: "Risk Resolver Test Household" })
    .returning({ id: crmHouseholds.id });
  const [client] = await db
    .insert(clients)
    .values({
      firmId,
      advisorId: "adv-risk-test",
      crmHouseholdId: household.id,
      retirementAge: 65,
      planEndAge: 95,
    })
    .returning({ id: clients.id });
  const [scenario] = await db
    .insert(scenarios)
    .values({ clientId: client.id, name: "Base Case", isBaseCase: true })
    .returning({ id: scenarios.id });
  await db.insert(planSettings).values({
    clientId: client.id,
    scenarioId: scenario.id,
    planStartYear: 2026,
    planEndYear: 2090,
  });
  return { scenarioId: scenario.id };
}

afterAll(async () => {
  // clients cascades to scenarios + plan_settings (onDelete: "cascade" on both
  // FKs); crm_households only cascades once the referencing client is gone
  // (clients.crm_household_id is onDelete: "restrict").
  await db.delete(clients).where(eq(clients.firmId, FIRM));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
  await db.delete(modelPortfolios).where(eq(modelPortfolios.firmId, FIRM));
});

describe("resolveRiskPortfolioId", () => {
  it("returns the firm's portfolio tagged with the rung, null when untagged", async () => {
    const [p] = await db
      .insert(modelPortfolios)
      .values({ firmId: FIRM, name: "Moderate Model", riskLevel: "moderate" })
      .returning({ id: modelPortfolios.id });

    expect(await resolveRiskPortfolioId(FIRM, "moderate")).toBe(p.id);
    expect(await resolveRiskPortfolioId(FIRM, "aggressive")).toBeNull();
    expect(await resolveRiskPortfolioId("other-firm", "moderate")).toBeNull();
  });
});

describe("applyRiskPortfolioToScenario", () => {
  it("sets taxable+retirement + growthSource, leaves cash untouched", async () => {
    const { scenarioId } = await seedClientWithScenario(FIRM);
    const [pf] = await db
      .insert(modelPortfolios)
      .values({ firmId: FIRM, name: "Apply Model", riskLevel: "aggressive" })
      .returning({ id: modelPortfolios.id });

    await db.transaction(async (tx) => {
      await applyRiskPortfolioToScenario(tx, scenarioId, pf.id);
    });

    const [ps] = await db
      .select()
      .from(planSettings)
      .where(eq(planSettings.scenarioId, scenarioId));
    expect(ps.modelPortfolioIdTaxable).toBe(pf.id);
    expect(ps.modelPortfolioIdRetirement).toBe(pf.id);
    expect(ps.growthSourceTaxable).toBe("model_portfolio");
    expect(ps.growthSourceRetirement).toBe("model_portfolio");
    expect(ps.modelPortfolioIdCash).toBeNull(); // untouched
    expect(ps.growthSourceCash).not.toBe("model_portfolio");
  });
});
