import { NextRequest, NextResponse } from "next/server";
import { db } from "@foundry/db";
import { clients, scenarios, accounts } from "@foundry/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import {
  assertEntitiesInClient,
  assertModelPortfoliosInFirm,
} from "@/lib/db-scoping";

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

// GET /api/clients/[id]/accounts — list accounts for base case scenario
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

    const rows = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/accounts — create account for base case scenario
export async function POST(
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
      name,
      category,
      subType,
      owner,
      value,
      basis,
      growthRate,
      rmdEnabled,
      ownerEntityId,
      growthSource,
      modelPortfolioId,
      turnoverPct,
      overridePctOi,
      overridePctLtCg,
      overridePctQdiv,
      overridePctTaxExempt,
    } = body;

    if (!name || !category) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const entCheck = await assertEntitiesInClient(id, [ownerEntityId]);
    if (!entCheck.ok) {
      return NextResponse.json({ error: entCheck.reason }, { status: 400 });
    }
    const mpCheck = await assertModelPortfoliosInFirm(firmId, [modelPortfolioId]);
    if (!mpCheck.ok) {
      return NextResponse.json({ error: mpCheck.reason }, { status: 400 });
    }

    const [account] = await db
      .insert(accounts)
      .values({
        clientId: id,
        scenarioId,
        name,
        category,
        subType: subType ?? "other",
        owner: owner ?? "client",
        value: value ?? "0",
        basis: basis ?? "0",
        // null = inherit the default growth rate for this category from plan_settings
        growthRate: growthRate ?? null,
        rmdEnabled: rmdEnabled ?? false,
        ownerEntityId: ownerEntityId ?? null,
        growthSource: growthSource ?? "default",
        modelPortfolioId: modelPortfolioId ?? null,
        turnoverPct: turnoverPct ?? "0",
        overridePctOi: overridePctOi ?? null,
        overridePctLtCg: overridePctLtCg ?? null,
        overridePctQdiv: overridePctQdiv ?? null,
        overridePctTaxExempt: overridePctTaxExempt ?? null,
        annualPropertyTax: body.annualPropertyTax ?? "0",
        propertyTaxGrowthRate: body.propertyTaxGrowthRate ?? "0.03",
      })
      .returning();

    return NextResponse.json(account, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
