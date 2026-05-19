// src/lib/life-insurance/settings.ts
//
// Load / save persistence helpers for the Life Insurance solver tab.
// One `life_insurance_solver_settings` row per client (UNIQUE on
// clientId). `loadLifeInsuranceSettings` falls back to
// `defaultAssumptions` when no row exists yet. Decimal columns round-trip
// through `string` in drizzle, so we convert on both edges.
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { lifeInsuranceSolverSettings } from "@/db/schema";
import type { ClientData } from "@/engine/types";
import type { LiAssumptions } from "./schema";

export function defaultAssumptions(data: ClientData): LiAssumptions {
  return {
    deathYear: data.planSettings.planStartYear + 1,
    growthRate: 0.05,
    leaveToHeirsAmount: 0,
    finalExpenses: data.planSettings.estateAdminExpenses ?? 25_000,
    livingExpenseAtDeath: null,
    payOffDebtsAtDeath: false,
    mcTargetScore: 0.9,
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
    growthRate: Number(row.liGrowthRate),
    leaveToHeirsAmount: Number(row.leaveToHeirsAmount),
    finalExpenses: Number(row.finalExpenses),
    livingExpenseAtDeath:
      row.livingExpenseAtDeath == null ? null : Number(row.livingExpenseAtDeath),
    payOffDebtsAtDeath: row.payOffDebtsAtDeath,
    mcTargetScore: Number(row.mcTargetScore),
  };
}

export async function saveLifeInsuranceSettings(
  clientId: string,
  a: LiAssumptions,
): Promise<void> {
  const values = {
    clientId,
    deathYear: a.deathYear,
    liGrowthRate: String(a.growthRate),
    leaveToHeirsAmount: String(a.leaveToHeirsAmount),
    finalExpenses: String(a.finalExpenses),
    livingExpenseAtDeath:
      a.livingExpenseAtDeath == null ? null : String(a.livingExpenseAtDeath),
    payOffDebtsAtDeath: a.payOffDebtsAtDeath,
    mcTargetScore: String(a.mcTargetScore),
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
