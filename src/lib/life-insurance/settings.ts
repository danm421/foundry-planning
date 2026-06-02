// src/lib/life-insurance/settings.ts
//
// Load / save persistence helpers for the Life Insurance solver tab.
// One `life_insurance_solver_settings` row per client (UNIQUE on
// clientId). `loadLifeInsuranceSettings` falls back to
// `defaultAssumptions` when no row exists yet. Decimal columns round-trip
// through `string` in drizzle, so we convert on both edges.
//
// Note: `modelPortfolioId` is not available on `ClientData.planSettings`
// (PlanSettings carries plan-year / tax-rate fields only). It defaults to
// null and is set explicitly by the user via the solver UI.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lifeInsuranceSolverSettings } from "@/db/schema";
import type { ClientData } from "@/engine/types";
import type { LiAssumptions } from "./schema";

export function defaultAssumptions(data: ClientData): LiAssumptions {
  return {
    deathYear: data.planSettings.planStartYear + 1,
    modelPortfolioId: null,
    leaveToHeirsAmount: 0,
    livingExpenseAtDeath: null,
    payoffLiabilityIds: [],
    mcTargetScore: 0.9,
    coverEstateTaxes: false,
    scenarioRef: "base",
  };
}

export async function loadLifeInsuranceSettings(
  clientId: string,
  data: ClientData,
): Promise<LiAssumptions> {
  const row = await db.query.lifeInsuranceSolverSettings.findFirst({
    where: eq(lifeInsuranceSolverSettings.clientId, clientId),
  });
  if (!row) return defaultAssumptions(data);
  return {
    deathYear: row.deathYear,
    modelPortfolioId: row.modelPortfolioId,
    leaveToHeirsAmount: Number(row.leaveToHeirsAmount),
    livingExpenseAtDeath:
      row.livingExpenseAtDeath == null ? null : Number(row.livingExpenseAtDeath),
    payoffLiabilityIds: row.payoffLiabilityIds ?? [],
    mcTargetScore: Number(row.mcTargetScore),
    coverEstateTaxes: row.coverEstateTaxes ?? false,
    // Not persisted on the settings row — UI-scoped, defaults to the base scenario.
    scenarioRef: "base",
  };
}

export async function saveLifeInsuranceSettings(
  clientId: string,
  a: LiAssumptions,
): Promise<void> {
  const values = {
    clientId,
    deathYear: a.deathYear,
    modelPortfolioId: a.modelPortfolioId,
    leaveToHeirsAmount: String(a.leaveToHeirsAmount),
    livingExpenseAtDeath:
      a.livingExpenseAtDeath == null ? null : String(a.livingExpenseAtDeath),
    payoffLiabilityIds: a.payoffLiabilityIds,
    mcTargetScore: String(a.mcTargetScore),
    coverEstateTaxes: a.coverEstateTaxes,
    updatedAt: new Date(),
  };
  await db
    .insert(lifeInsuranceSolverSettings)
    .values(values)
    .onConflictDoUpdate({
      target: lifeInsuranceSolverSettings.clientId,
      set: values,
    });
}
