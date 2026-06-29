import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { modelPortfolios, scenarios, planSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { isUSPSStateCode } from "@/lib/usps-states";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// GET /api/clients/[id]/plan-settings — get plan settings for base case
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [settings] = await db
      .select()
      .from(planSettings)
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenarioId)));

    if (!settings) {
      return NextResponse.json({ error: "No plan settings found" }, { status: 404 });
    }

    return NextResponse.json(settings);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/plan-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id]/plan-settings — update plan settings for base case
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      flatFederalRate,
      flatStateRate,
      estateAdminExpenses,
      flatStateEstateRate,
      residenceState,
      irdTaxRate,
      probateCostRate,
      outOfHouseholdDniRate,
      priorTaxableGiftsClient,
      priorTaxableGiftsSpouse,
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
    } = body;

    if (selectedBenchmarkPortfolioId) {
      const [portfolio] = await db
        .select()
        .from(modelPortfolios)
        .where(and(
          eq(modelPortfolios.id, selectedBenchmarkPortfolioId),
          eq(modelPortfolios.firmId, firmId),
        ));
      if (!portfolio) {
        return NextResponse.json(
          { error: "Benchmark portfolio not found" },
          { status: 404 },
        );
      }
    }

    if (typeof planStartYear === "number") {
      const currentYear = new Date().getFullYear();
      if (planStartYear < currentYear) {
        return NextResponse.json(
          { error: `Plan start year cannot be before current year (${currentYear})` },
          { status: 400 }
        );
      }
    }

    if (typeof estateAdminExpenses === "number" && estateAdminExpenses < 0) {
      return NextResponse.json(
        { error: "estateAdminExpenses must be non-negative" },
        { status: 400 },
      );
    }

    if (typeof flatStateEstateRate === "number" &&
        (flatStateEstateRate < 0 || flatStateEstateRate > 1)) {
      return NextResponse.json(
        { error: "flatStateEstateRate must be between 0 and 1" },
        { status: 400 },
      );
    }

    if (residenceState !== undefined && residenceState !== null) {
      if (!isUSPSStateCode(residenceState)) {
        return NextResponse.json(
          { error: "residenceState must be a USPS 2-letter code for a US state or DC (or null)" },
          { status: 400 },
        );
      }
    }

    if (typeof irdTaxRate === "number" &&
        (irdTaxRate < 0 || irdTaxRate > 1)) {
      return NextResponse.json(
        { error: "irdTaxRate must be between 0 and 1" },
        { status: 400 },
      );
    }

    if (typeof probateCostRate === "number" &&
        (probateCostRate < 0 || probateCostRate > 1)) {
      return NextResponse.json(
        { error: "probateCostRate must be between 0 and 1" },
        { status: 400 },
      );
    }

    if (typeof outOfHouseholdDniRate === "number" &&
        (outOfHouseholdDniRate < 0 || outOfHouseholdDniRate > 1)) {
      return NextResponse.json(
        { error: "outOfHouseholdDniRate must be between 0 and 1" },
        { status: 400 },
      );
    }

    if (typeof priorTaxableGiftsClient === "number" && priorTaxableGiftsClient < 0) {
      return NextResponse.json(
        { error: "priorTaxableGiftsClient must be non-negative" },
        { status: 400 },
      );
    }
    if (typeof priorTaxableGiftsSpouse === "number" && priorTaxableGiftsSpouse < 0) {
      return NextResponse.json(
        { error: "priorTaxableGiftsSpouse must be non-negative" },
        { status: 400 },
      );
    }

    if (lifetimeExemptionCap != null && Number(lifetimeExemptionCap) < 0) {
      return NextResponse.json(
        { error: "lifetimeExemptionCap must be non-negative" },
        { status: 400 },
      );
    }

    if (typeof surplusSpendPct === "number" &&
        (surplusSpendPct < 0 || surplusSpendPct > 1)) {
      return NextResponse.json(
        { error: "surplusSpendPct must be between 0 and 1" },
        { status: 400 },
      );
    }

    if (typeof medicarePremiumInflationRate === "number" &&
        (medicarePremiumInflationRate < 0 || medicarePremiumInflationRate > 1)) {
      return NextResponse.json(
        { error: "medicarePremiumInflationRate must be between 0 and 1" },
        { status: 400 },
      );
    }

    const [updated] = await db
      .update(planSettings)
      .set({
        flatFederalRate: flatFederalRate != null ? String(flatFederalRate) : undefined,
        flatStateRate: flatStateRate != null ? String(flatStateRate) : undefined,
        estateAdminExpenses: estateAdminExpenses != null ? String(estateAdminExpenses) : undefined,
        flatStateEstateRate: flatStateEstateRate != null ? String(flatStateEstateRate) : undefined,
        residenceState: "residenceState" in body ? (residenceState ?? null) : undefined,
        irdTaxRate: irdTaxRate != null ? String(irdTaxRate) : undefined,
        probateCostRate: probateCostRate != null ? String(probateCostRate) : undefined,
        outOfHouseholdDniRate: outOfHouseholdDniRate != null ? String(outOfHouseholdDniRate) : undefined,
        priorTaxableGiftsClient: priorTaxableGiftsClient != null ? String(priorTaxableGiftsClient) : undefined,
        priorTaxableGiftsSpouse: priorTaxableGiftsSpouse != null ? String(priorTaxableGiftsSpouse) : undefined,
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
        inflationRateSource: inflationRateSource === "custom" || inflationRateSource === "asset_class"
          ? inflationRateSource
          : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenarioId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Plan settings not found" }, { status: 404 });
    }

    await recordAudit({
      action: "plan_settings.update",
      resourceType: "plan_settings",
      resourceId: updated.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { scenarioId }),
    });

    return NextResponse.json(updated);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/plan-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
