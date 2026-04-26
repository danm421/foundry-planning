import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, entities, gifts, planSettings } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { giftSeriesSchema } from "@/lib/schemas/gift-series";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const parsed = await parseBody(giftSeriesSchema, request);
    if (!parsed.ok) return parsed.response;
    const data = parsed.data;

    const [trust] = await db
      .select()
      .from(entities)
      .where(and(eq(entities.id, data.recipientEntityId), eq(entities.clientId, id)));
    if (!trust) {
      return NextResponse.json({ error: "Recipient entity not found for this client" }, { status: 400 });
    }
    if (trust.entityType !== "trust" || !trust.isIrrevocable) {
      return NextResponse.json(
        { error: "Recurring gifts target irrevocable trusts only" },
        { status: 400 },
      );
    }

    let inflationRate = 0;
    if (data.inflationAdjust) {
      const [settings] = await db
        .select()
        .from(planSettings)
        .where(eq(planSettings.clientId, id));
      inflationRate = settings ? parseFloat(settings.inflationRate) : 0;
    }

    const giftIds = await db.transaction(async (tx) => {
      const rows = [];
      for (let y = data.startYear; y <= data.endYear; y++) {
        const i = y - data.startYear;
        const amt = data.inflationAdjust
          ? data.annualAmount * Math.pow(1 + inflationRate, i)
          : data.annualAmount;
        rows.push({
          clientId: id,
          year: y,
          amount: amt.toFixed(2),
          grantor: data.grantor,
          recipientEntityId: data.recipientEntityId,
        });
      }
      const inserted = await tx.insert(gifts).values(rows).returning({ id: gifts.id });
      return inserted.map((r) => r.id);
    });

    return NextResponse.json({ giftIds }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/gifts/series error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
