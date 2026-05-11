import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, clientComparisonLayouts } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { ComparisonLayoutSchema } from "@/lib/comparison/layout-schema";
import { loadLayout } from "@/lib/comparison/load-layout";

export const dynamic = "force-dynamic";

async function requireClientInFirm(id: string, firmId: string) {
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  return client ?? null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const client = await requireClientInFirm(id, firmId);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const layout = await loadLayout(id, firmId);
    return NextResponse.json({ layout });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("GET /api/clients/[id]/comparison-layout error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const client = await requireClientInFirm(id, firmId);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = ComparisonLayoutSchema.parse(await req.json());

    const [row] = await db
      .insert(clientComparisonLayouts)
      .values({ firmId, clientId: id, layout: body })
      .onConflictDoUpdate({
        target: clientComparisonLayouts.clientId,
        set: { layout: body, updatedAt: new Date() },
      })
      .returning();

    await recordAudit({
      action: "comparison_layout.upsert",
      resourceType: "comparison_layout",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: { itemCount: body.items.length },
    });

    return NextResponse.json({ layout: body });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("PUT /api/clients/[id]/comparison-layout error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
