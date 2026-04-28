import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, giftSeries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { giftSeriesUpdateSchema } from "@/lib/schemas/gift-series";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string, firmId: string): Promise<boolean> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
  return !!client;
}

// PATCH /api/clients/[id]/gifts/series/[seriesId] — partial update
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; seriesId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, seriesId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = giftSeriesUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const d = parsed.data;

    // If endYear/startYear are both provided, validate ordering
    if (d.startYear !== undefined && d.endYear !== undefined && d.endYear < d.startYear) {
      return NextResponse.json(
        { error: "endYear must be ≥ startYear" },
        { status: 400 },
      );
    }

    const [updated] = await db
      .update(giftSeries)
      .set({
        ...(d.grantor !== undefined && { grantor: d.grantor }),
        ...(d.recipientEntityId !== undefined && {
          recipientEntityId: d.recipientEntityId,
        }),
        ...(d.startYear !== undefined && { startYear: d.startYear }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(d.startYearRef !== undefined && { startYearRef: d.startYearRef as any }),
        ...(d.endYear !== undefined && { endYear: d.endYear }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(d.endYearRef !== undefined && { endYearRef: d.endYearRef as any }),
        ...(d.annualAmount !== undefined && {
          annualAmount: d.annualAmount.toString(),
        }),
        ...(d.inflationAdjust !== undefined && {
          inflationAdjust: d.inflationAdjust,
        }),
        ...(d.useCrummeyPowers !== undefined && {
          useCrummeyPowers: d.useCrummeyPowers,
        }),
        ...(d.notes !== undefined && { notes: d.notes ?? null }),
        updatedAt: new Date(),
      })
      .where(and(eq(giftSeries.id, seriesId), eq(giftSeries.clientId, id)))
      .returning();

    if (!updated) {
      return NextResponse.json({ error: "Gift series not found" }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PATCH /api/clients/[id]/gifts/series/[seriesId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/gifts/series/[seriesId] — remove a gift_series row
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; seriesId: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id, seriesId } = await params;
    if (!(await verifyClient(id, firmId))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const [deleted] = await db
      .delete(giftSeries)
      .where(and(eq(giftSeries.id, seriesId), eq(giftSeries.clientId, id)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Gift series not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/gifts/series/[seriesId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
