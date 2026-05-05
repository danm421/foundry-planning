import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  clients,
  scenarios,
  rothConversions,
  rothConversionSources,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { assertAccountsInClient } from "@/lib/db-scoping";
import { recordCreate, recordUpdate, recordDelete } from "@/lib/audit";
import {
  toRothConversionSnapshot,
  ROTH_CONVERSION_FIELD_LABELS,
} from "@/lib/audit/snapshots/roth-conversion";

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

// GET /api/clients/[id]/roth-conversions
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const rows = await db
      .select()
      .from(rothConversions)
      .where(and(eq(rothConversions.clientId, id), eq(rothConversions.scenarioId, scenarioId)));

    let sourceRows: (typeof rothConversionSources.$inferSelect)[] = [];
    if (rows.length > 0) {
      sourceRows = await db
        .select()
        .from(rothConversionSources)
        .where(inArray(rothConversionSources.rothConversionId, rows.map((r) => r.id)));
    }

    const result = rows.map((r) => ({
      ...r,
      sources: sourceRows
        .filter((s) => s.rothConversionId === r.id)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/roth-conversions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/roth-conversions
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const body = await req.json();
    const {
      name,
      destinationAccountId,
      sourceAccountIds,
      conversionType,
      fixedAmount,
      fillUpBracket,
      startYear,
      startYearRef,
      endYear,
      endYearRef,
      indexingRate,
      inflationStartYear,
    } = body;

    if (
      !name ||
      !destinationAccountId ||
      typeof startYear !== "number" ||
      !Array.isArray(sourceAccountIds) ||
      sourceAccountIds.length === 0
    ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const accountCheck = await assertAccountsInClient(id, [
      destinationAccountId as string,
      ...(sourceAccountIds as string[]),
    ]);
    if (!accountCheck.ok) {
      return NextResponse.json({ error: accountCheck.reason }, { status: 400 });
    }

    const [created] = await db
      .insert(rothConversions)
      .values({
        clientId: id,
        scenarioId,
        name,
        destinationAccountId,
        conversionType: conversionType ?? "fixed_amount",
        fixedAmount: fixedAmount != null ? String(fixedAmount) : "0",
        fillUpBracket: fillUpBracket != null ? String(fillUpBracket) : null,
        startYear,
        startYearRef: startYearRef ?? null,
        endYear: endYear ?? null,
        endYearRef: endYearRef ?? null,
        indexingRate: indexingRate != null ? String(indexingRate) : "0",
        inflationStartYear: inflationStartYear ?? null,
      })
      .returning();

    if (sourceAccountIds.length > 0) {
      await db.insert(rothConversionSources).values(
        (sourceAccountIds as string[]).map((accountId, idx) => ({
          rothConversionId: created.id,
          accountId,
          sortOrder: idx,
        })),
      );
    }

    const insertedSources = await db
      .select()
      .from(rothConversionSources)
      .where(eq(rothConversionSources.rothConversionId, created.id));

    await recordCreate({
      action: "roth_conversion.create",
      resourceType: "roth_conversion",
      resourceId: created.id,
      clientId: id,
      firmId,
      snapshot: await toRothConversionSnapshot(created),
    });

    return NextResponse.json(
      { ...created, sources: insertedSources },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/roth-conversions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id]/roth-conversions
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const body = await req.json();
    const {
      rothConversionId,
      name,
      destinationAccountId,
      sourceAccountIds,
      conversionType,
      fixedAmount,
      fillUpBracket,
      startYear,
      startYearRef,
      endYear,
      endYearRef,
      indexingRate,
      inflationStartYear,
    } = body;

    if (!rothConversionId) {
      return NextResponse.json({ error: "Missing rothConversionId" }, { status: 400 });
    }

    const accountIdsToCheck = [
      ...(destinationAccountId ? [destinationAccountId] : []),
      ...(Array.isArray(sourceAccountIds) ? sourceAccountIds : []),
    ];
    if (accountIdsToCheck.length > 0) {
      const accountCheck = await assertAccountsInClient(id, accountIdsToCheck);
      if (!accountCheck.ok) {
        return NextResponse.json({ error: accountCheck.reason }, { status: 400 });
      }
    }

    const [before] = await db
      .select()
      .from(rothConversions)
      .where(and(eq(rothConversions.id, rothConversionId), eq(rothConversions.clientId, id)));

    if (!before) {
      return NextResponse.json({ error: "Roth conversion not found" }, { status: 404 });
    }

    const [updated] = await db
      .update(rothConversions)
      .set({
        ...(name !== undefined && { name }),
        ...(destinationAccountId !== undefined && { destinationAccountId }),
        ...(conversionType !== undefined && { conversionType }),
        ...(fixedAmount !== undefined && { fixedAmount: String(fixedAmount) }),
        ...(fillUpBracket !== undefined && {
          fillUpBracket: fillUpBracket == null ? null : String(fillUpBracket),
        }),
        ...(startYear !== undefined && { startYear }),
        ...(startYearRef !== undefined && { startYearRef: startYearRef ?? null }),
        ...(endYear !== undefined && { endYear: endYear ?? null }),
        ...(endYearRef !== undefined && { endYearRef: endYearRef ?? null }),
        ...(indexingRate !== undefined && { indexingRate: String(indexingRate) }),
        ...(inflationStartYear !== undefined && {
          inflationStartYear: inflationStartYear ?? null,
        }),
        updatedAt: new Date(),
      })
      .where(and(eq(rothConversions.id, rothConversionId), eq(rothConversions.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Roth conversion not found" }, { status: 404 });
    }

    if (Array.isArray(sourceAccountIds)) {
      await db
        .delete(rothConversionSources)
        .where(eq(rothConversionSources.rothConversionId, rothConversionId));
      if (sourceAccountIds.length > 0) {
        await db.insert(rothConversionSources).values(
          (sourceAccountIds as string[]).map((accountId, idx) => ({
            rothConversionId,
            accountId,
            sortOrder: idx,
          })),
        );
      }
    }

    const updatedSources = await db
      .select()
      .from(rothConversionSources)
      .where(eq(rothConversionSources.rothConversionId, rothConversionId));

    await recordUpdate({
      action: "roth_conversion.update",
      resourceType: "roth_conversion",
      resourceId: rothConversionId,
      clientId: id,
      firmId,
      before: await toRothConversionSnapshot(before),
      after: await toRothConversionSnapshot(updated),
      fieldLabels: ROTH_CONVERSION_FIELD_LABELS,
    });

    return NextResponse.json({ ...updated, sources: updatedSources });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/roth-conversions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/roth-conversions?rothConversionId=...
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const rothConversionId = searchParams.get("rothConversionId");
    if (!rothConversionId) {
      return NextResponse.json({ error: "Missing rothConversionId" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(rothConversions)
      .where(and(eq(rothConversions.id, rothConversionId), eq(rothConversions.clientId, id)));

    if (!existing) {
      return NextResponse.json({ error: "Roth conversion not found" }, { status: 404 });
    }

    const snapshot = await toRothConversionSnapshot(existing);

    await db
      .delete(rothConversions)
      .where(and(eq(rothConversions.id, rothConversionId), eq(rothConversions.clientId, id)));

    await recordDelete({
      action: "roth_conversion.delete",
      resourceType: "roth_conversion",
      resourceId: rothConversionId,
      clientId: id,
      firmId,
      snapshot,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/roth-conversions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
