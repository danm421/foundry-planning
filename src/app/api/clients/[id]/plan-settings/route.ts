import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, modelPortfolios, scenarios, planSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string, firmId: string): Promise<string | null> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

  if (!client) return null;

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
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
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
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      flatFederalRate,
      flatStateRate,
      estateAdminExpenses,
      flatStateEstateRate,
      outOfHouseholdDniRate,
      priorTaxableGiftsClient,
      priorTaxableGiftsSpouse,
      inflationRate,
      taxEngineMode,
      taxInflationRate,
      ssWageGrowthRate,
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
      modelPortfolioIdTaxable,
      modelPortfolioIdCash,
      modelPortfolioIdRetirement,
      selectedBenchmarkPortfolioId,
      inflationRateSource,
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

    const [updated] = await db
      .update(planSettings)
      .set({
        flatFederalRate: flatFederalRate != null ? String(flatFederalRate) : undefined,
        flatStateRate: flatStateRate != null ? String(flatStateRate) : undefined,
        estateAdminExpenses: estateAdminExpenses != null ? String(estateAdminExpenses) : undefined,
        flatStateEstateRate: flatStateEstateRate != null ? String(flatStateEstateRate) : undefined,
        outOfHouseholdDniRate: outOfHouseholdDniRate != null ? String(outOfHouseholdDniRate) : undefined,
        priorTaxableGiftsClient: priorTaxableGiftsClient != null ? String(priorTaxableGiftsClient) : undefined,
        priorTaxableGiftsSpouse: priorTaxableGiftsSpouse != null ? String(priorTaxableGiftsSpouse) : undefined,
        inflationRate: inflationRate != null ? String(inflationRate) : undefined,
        taxEngineMode: taxEngineMode != null ? taxEngineMode : undefined,
        taxInflationRate: "taxInflationRate" in body
          ? (taxInflationRate === null ? null : String(taxInflationRate))
          : undefined,
        ssWageGrowthRate: "ssWageGrowthRate" in body
          ? (ssWageGrowthRate === null ? null : String(ssWageGrowthRate))
          : undefined,
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
        modelPortfolioIdTaxable: modelPortfolioIdTaxable !== undefined ? modelPortfolioIdTaxable : undefined,
        modelPortfolioIdCash: modelPortfolioIdCash !== undefined ? modelPortfolioIdCash : undefined,
        modelPortfolioIdRetirement: modelPortfolioIdRetirement !== undefined ? modelPortfolioIdRetirement : undefined,
        selectedBenchmarkPortfolioId: "selectedBenchmarkPortfolioId" in body
          ? (selectedBenchmarkPortfolioId === null ? null : selectedBenchmarkPortfolioId)
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
      metadata: { scenarioId },
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/plan-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
