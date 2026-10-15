// src/lib/clients/plan-settings-writes.ts
//
// Plan settings update core, moved from PUT /api/clients/[id]/plan-settings
// (which now calls it) so the fact finder save can write the base case's tax
// settings on its transaction. Always the base case; an update only — the row
// is seeded when the client is created. The two workplace-coverage choices
// live on the clients row and are written in the same transaction.
import { modelPortfolios, planSettings, clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { recordAudit } from "@/lib/audit";
import { handleOf, inTransaction, type WriteOptions } from "@/lib/db-tx";
import { validatePlanSettingsPatch } from "@/lib/plan-settings/validate-patch";
import { baseCaseScenarioId } from "./base-case";
import { writeError, type EntityWriteResult } from "./entity-write-result";

type WorkplaceCoverage = { coveredByWorkplacePlan?: "auto" | "yes" | "no"; spouseCoveredByWorkplacePlan?: "auto" | "yes" | "no" };
/** The body's keys as the columns name them — no schema; validatePlanSettingsPatch checks the values and the writes coerce them. */
type PlanSettingsBody = Partial<typeof planSettings.$inferInsert> & WorkplaceCoverage;

export async function updatePlanSettingsForClient(args: {
  clientId: string;
  firmId: string;
  /** Omitted by the route, so the audit resolves the session's actor itself. */
  actorId?: string;
  body: Record<string, unknown>;
  crossFirmMeta?: Record<string, unknown>;
} & WriteOptions): Promise<EntityWriteResult<Record<string, unknown>>> {
  const { clientId, firmId, actorId, body, crossFirmMeta } = args;

  const scenarioId = await baseCaseScenarioId(clientId, firmId);
  if (!scenarioId) return writeError(404, "Client not found");

  const {
    flatFederalRate,
    flatStateRate,
    estateAdminExpenses,
    flatStateEstateRate,
    residenceState,
    irdTaxRate,
    probateCostRate,
    pvDiscountRate,
    outOfHouseholdDniRate,
    priorTaxableGiftsClient,
    priorTaxableGiftsSpouse,
    capitalLossCarryforwardSt,
    capitalLossCarryforwardLt,
    inflationRate,
    taxEngineMode,
    taxInflationRate,
    lifetimeExemptionCap,
    ssWageGrowthRate,
    medicarePremiumInflationRate,
    medicarePremiumInflationEnabled,
    planStartYear,
    planEndYear,
    defaultGrowthTaxable,
    defaultGrowthCash,
    defaultGrowthRetirement,
    defaultGrowthRealEstate,
    defaultGrowthBusiness,
    defaultGrowthLifeInsurance,
    growthSourceTaxable,
    growthSourceCash,
    growthSourceRetirement,
    growthSourceRealEstate,
    growthSourceBusiness,
    growthSourceLifeInsurance,
    modelPortfolioIdTaxable,
    modelPortfolioIdCash,
    modelPortfolioIdRetirement,
    selectedBenchmarkPortfolioId,
    inflationRateSource,
    surplusSpendPct,
    surplusSaveAccountId,
    surplusSpendAllUntilRetirement,
    coveredByWorkplacePlan,
    spouseCoveredByWorkplacePlan,
  } = body as PlanSettingsBody;

  if (selectedBenchmarkPortfolioId) {
    const [portfolio] = await handleOf(args)
      .select()
      .from(modelPortfolios)
      .where(and(
        eq(modelPortfolios.id, selectedBenchmarkPortfolioId),
        eq(modelPortfolios.firmId, firmId),
      ));
    if (!portfolio) return writeError(404, "Benchmark portfolio not found");
  }

  const invalid = validatePlanSettingsPatch(body);
  if (invalid) return writeError(400, invalid);

  // coveredByWorkplacePlan / spouseCoveredByWorkplacePlan live on `clients`
  // (household-level, not scenario-level), not on `planSettings` — a second
  // update against the right table, in the same transaction as the
  // planSettings write so a mid-request failure can't leave one committed
  // without the other.
  const { updated, updatedClientFields } = await inTransaction(args, async (tx) => {
    const [updatedRow] = await tx
      .update(planSettings)
      .set({
        flatFederalRate: flatFederalRate != null ? String(flatFederalRate) : undefined,
        flatStateRate: flatStateRate != null ? String(flatStateRate) : undefined,
        estateAdminExpenses: estateAdminExpenses != null ? String(estateAdminExpenses) : undefined,
        flatStateEstateRate: flatStateEstateRate != null ? String(flatStateEstateRate) : undefined,
        residenceState: "residenceState" in body ? (residenceState ?? null) : undefined,
        irdTaxRate: irdTaxRate != null ? String(irdTaxRate) : undefined,
        probateCostRate: probateCostRate != null ? String(probateCostRate) : undefined,
        pvDiscountRate: "pvDiscountRate" in body
          ? (pvDiscountRate === null ? null : String(pvDiscountRate))
          : undefined,
        outOfHouseholdDniRate: outOfHouseholdDniRate != null ? String(outOfHouseholdDniRate) : undefined,
        priorTaxableGiftsClient: priorTaxableGiftsClient != null ? String(priorTaxableGiftsClient) : undefined,
        priorTaxableGiftsSpouse: priorTaxableGiftsSpouse != null ? String(priorTaxableGiftsSpouse) : undefined,
        capitalLossCarryforwardSt: "capitalLossCarryforwardSt" in body
          ? (capitalLossCarryforwardSt === null ? null : String(capitalLossCarryforwardSt))
          : undefined,
        capitalLossCarryforwardLt: "capitalLossCarryforwardLt" in body
          ? (capitalLossCarryforwardLt === null ? null : String(capitalLossCarryforwardLt))
          : undefined,
        inflationRate: inflationRate != null ? String(inflationRate) : undefined,
        taxEngineMode: taxEngineMode != null ? taxEngineMode : undefined,
        taxInflationRate: "taxInflationRate" in body
          ? (taxInflationRate === null ? null : String(taxInflationRate))
          : undefined,
        lifetimeExemptionCap: "lifetimeExemptionCap" in body
          ? (lifetimeExemptionCap === null ? null : String(lifetimeExemptionCap))
          : undefined,
        ssWageGrowthRate: "ssWageGrowthRate" in body
          ? (ssWageGrowthRate === null ? null : String(ssWageGrowthRate))
          : undefined,
        medicarePremiumInflationRate: medicarePremiumInflationRate != null ? String(medicarePremiumInflationRate) : undefined,
        medicarePremiumInflationEnabled: typeof medicarePremiumInflationEnabled === "boolean" ? medicarePremiumInflationEnabled : undefined,
        planStartYear: planStartYear != null ? Number(planStartYear) : undefined,
        planEndYear: planEndYear != null ? Number(planEndYear) : undefined,
        defaultGrowthTaxable: defaultGrowthTaxable != null ? String(defaultGrowthTaxable) : undefined,
        defaultGrowthCash: defaultGrowthCash != null ? String(defaultGrowthCash) : undefined,
        defaultGrowthRetirement: defaultGrowthRetirement != null ? String(defaultGrowthRetirement) : undefined,
        defaultGrowthRealEstate: defaultGrowthRealEstate != null ? String(defaultGrowthRealEstate) : undefined,
        defaultGrowthBusiness: defaultGrowthBusiness != null ? String(defaultGrowthBusiness) : undefined,
        defaultGrowthLifeInsurance: defaultGrowthLifeInsurance != null ? String(defaultGrowthLifeInsurance) : undefined,
        growthSourceTaxable: growthSourceTaxable ?? undefined,
        growthSourceCash: growthSourceCash ?? undefined,
        growthSourceRetirement: growthSourceRetirement ?? undefined,
        growthSourceRealEstate: growthSourceRealEstate ?? undefined,
        growthSourceBusiness: growthSourceBusiness ?? undefined,
        growthSourceLifeInsurance: growthSourceLifeInsurance ?? undefined,
        modelPortfolioIdTaxable: modelPortfolioIdTaxable !== undefined ? modelPortfolioIdTaxable : undefined,
        modelPortfolioIdCash: modelPortfolioIdCash !== undefined ? modelPortfolioIdCash : undefined,
        modelPortfolioIdRetirement: modelPortfolioIdRetirement !== undefined ? modelPortfolioIdRetirement : undefined,
        selectedBenchmarkPortfolioId: "selectedBenchmarkPortfolioId" in body
          ? (selectedBenchmarkPortfolioId === null ? null : selectedBenchmarkPortfolioId)
          : undefined,
        surplusSpendPct: surplusSpendPct != null ? String(surplusSpendPct) : undefined,
        surplusSaveAccountId: "surplusSaveAccountId" in body
          ? (surplusSaveAccountId === null ? null : surplusSaveAccountId)
          : undefined,
        // Explicit false must persist (the setting has to be turnable off);
        // an absent key stays undefined = "don't touch".
        surplusSpendAllUntilRetirement:
          typeof surplusSpendAllUntilRetirement === "boolean"
            ? surplusSpendAllUntilRetirement
            : undefined,
        inflationRateSource: inflationRateSource === "custom" || inflationRateSource === "asset_class"
          ? inflationRateSource
          : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(planSettings.clientId, clientId), eq(planSettings.scenarioId, scenarioId)))
      .returning();

    if (!updatedRow) {
      return { updated: null, updatedClientFields: {} as WorkplaceCoverage };
    }

    let clientFields: WorkplaceCoverage = {};
    if (coveredByWorkplacePlan !== undefined || spouseCoveredByWorkplacePlan !== undefined) {
      const [updatedClient] = await tx
        .update(clients)
        .set({
          ...(coveredByWorkplacePlan !== undefined && { coveredByWorkplacePlan }),
          ...(spouseCoveredByWorkplacePlan !== undefined && { spouseCoveredByWorkplacePlan }),
          updatedAt: new Date(),
        })
        .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)))
        .returning({
          coveredByWorkplacePlan: clients.coveredByWorkplacePlan,
          spouseCoveredByWorkplacePlan: clients.spouseCoveredByWorkplacePlan,
        });
      // requireClientEditAccess already proved this client/firm pair exists,
      // so a zero-row match here means something changed underneath us
      // (row deleted, or the predicate widened) — throw rather than
      // silently returning 200 with these two columns unchanged. Inside the
      // transaction, this rolls back the planSettings write too.
      if (!updatedClient) {
        throw new Error(`clients row not found for update (id=${clientId}, firmId=${firmId})`);
      }
      clientFields = updatedClient;
    }

    return { updated: updatedRow, updatedClientFields: clientFields };
  });

  if (!updated) return writeError(404, "Plan settings not found");

  await recordAudit({
    action: "plan_settings.update",
    resourceType: "plan_settings",
    resourceId: updated.id,
    clientId,
    firmId,
    actorId,
    metadata: { scenarioId, ...(crossFirmMeta ?? {}) },
    tx: args.tx,
  });

  if (Object.keys(updatedClientFields).length > 0) {
    await recordAudit({
      action: "client.update",
      resourceType: "client",
      resourceId: clientId,
      clientId,
      firmId,
      actorId,
      metadata: { ...updatedClientFields, ...(crossFirmMeta ?? {}) },
      tx: args.tx,
    });
  }

  return { ok: true, data: { ...updated, ...updatedClientFields }, resourceId: updated.id };
}
