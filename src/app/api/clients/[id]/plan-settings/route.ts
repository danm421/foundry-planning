import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, modelPortfolios, scenarios, planSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

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
    const firmId = await getOrgId();
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
    const firmId = await getOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      flatFederalRate,
      flatStateRate,
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

    const [updated] = await db
      .update(planSettings)
      .set({
        flatFederalRate: flatFederalRate != null ? String(flatFederalRate) : undefined,
        flatStateRate: flatStateRate != null ? String(flatStateRate) : undefined,
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
        updatedAt: new Date(),
      })
      .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenarioId)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Plan settings not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/plan-settings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
