import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { entities, giftSeries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { parseBody } from "@/lib/schemas/common";
import { giftSeriesUpdateSchema } from "@/lib/schemas/gift-series";

export const dynamic = "force-dynamic";

// PATCH /api/clients/[id]/gifts/series/[seriesId] — partial update
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; seriesId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, seriesId } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const parsed = await parseBody(giftSeriesUpdateSchema, request);
    if (!parsed.ok) return parsed.response;
    const d = parsed.data;

    // If endYear/startYear are both provided, validate ordering
    if (d.startYear !== undefined && d.endYear !== undefined && d.endYear < d.startYear) {
      return NextResponse.json(
        { error: "endYear must be ≥ startYear" },
        { status: 400 },
      );
    }

    // Re-validate recipient trust on PATCH: prevents cross-client tampering
    // (re-targeting a series at another client's trust) and re-targeting a
    // series at a revocable trust mid-stream. Mirrors POST validation.
    if (d.recipientEntityId !== undefined) {
      const [trust] = await db
        .select()
        .from(entities)
        .where(and(eq(entities.id, d.recipientEntityId), eq(entities.clientId, id)));
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
    }

    const [updated] = await db
      .update(giftSeries)
      .set({
        ...(d.grantor !== undefined && { grantor: d.grantor }),
        ...(d.recipientEntityId !== undefined && {
          recipientEntityId: d.recipientEntityId,
        }),
        ...(d.startYear !== undefined && { startYear: d.startYear }),
        ...(d.startYearRef !== undefined && {
          startYearRef: d.startYearRef as typeof giftSeries.$inferInsert["startYearRef"],
        }),
        ...(d.endYear !== undefined && { endYear: d.endYear }),
        ...(d.endYearRef !== undefined && {
          endYearRef: d.endYearRef as typeof giftSeries.$inferInsert["endYearRef"],
        }),
        ...(d.annualAmount !== undefined && {
          annualAmount: d.annualAmount.toString(),
        }),
        ...(d.amountMode !== undefined && { amountMode: d.amountMode }),
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

    await recordAudit({
      action: "gift_series.update",
      resourceType: "gift_series",
      resourceId: seriesId,
      clientId: id,
      firmId,
    });

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
    const firmId = await requireOrgId();
    const { id, seriesId } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const [deleted] = await db
      .delete(giftSeries)
      .where(and(eq(giftSeries.id, seriesId), eq(giftSeries.clientId, id)))
      .returning();

    if (!deleted) {
      return NextResponse.json({ error: "Gift series not found" }, { status: 404 });
    }

    await recordAudit({
      action: "gift_series.delete",
      resourceType: "gift_series",
      resourceId: seriesId,
      clientId: id,
      firmId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/gifts/series/[seriesId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
