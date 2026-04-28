import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, entities, giftSeries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { giftSeriesSchema } from "@/lib/schemas/gift-series";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(
  clientId: string,
  firmId: string,
): Promise<string | null> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

  if (!client) return null;

  // LIMIT 2 to surface the "multiple base scenarios" data-integrity bug loudly
  // rather than silently picking an arbitrary one.
  const baseScenarios = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(2);

  if (baseScenarios.length > 1) {
    throw new Error(
      `Multiple base scenarios for client ${clientId}: invariant violated`,
    );
  }
  return baseScenarios[0]?.id ?? null;
}

// GET /api/clients/[id]/gifts/series — list gift_series rows for base-case scenario
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(giftSeries)
      .where(and(eq(giftSeries.clientId, id), eq(giftSeries.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/gifts/series error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/gifts/series — create a gift_series row (base-case scenario)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const parsed = await parseBody(giftSeriesSchema, request);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    // Validate the recipient entity belongs to this client and is an irrevocable trust
    const [trust] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, data.recipientEntityId), eq(entities.clientId, id)));
    if (!trust) {
      return NextResponse.json(
        { error: "Recipient entity not found for this client" },
        { status: 400 },
      );
    }
    if (trust.entityType !== "trust" || !trust.isIrrevocable) {
      return NextResponse.json(
        { error: "Recurring gifts target irrevocable trusts only" },
        { status: 400 },
      );
    }

    const [row] = await db
      .insert(giftSeries)
      .values({
        clientId: id,
        scenarioId,
        grantor: data.grantor,
        recipientEntityId: data.recipientEntityId,
        startYear: data.startYear,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        startYearRef: (data.startYearRef ?? null) as any,
        endYear: data.endYear,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        endYearRef: (data.endYearRef ?? null) as any,
        annualAmount: data.annualAmount.toString(),
        inflationAdjust: data.inflationAdjust ?? false,
        useCrummeyPowers: data.useCrummeyPowers ?? false,
        notes: data.notes ?? null,
      })
      .returning();

    return NextResponse.json({ id: row.id }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/gifts/series error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
