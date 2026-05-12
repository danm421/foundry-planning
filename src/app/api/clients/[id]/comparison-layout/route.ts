import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, clientComparisonLayouts } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { authErrorResponse } from "@/lib/authz";
import { ComparisonLayoutV5Schema } from "@/lib/comparison/layout-schema";
import { validateLayoutV5 } from "@/lib/comparison/validate-layout-v5";
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

    const layout = await loadLayout(id, firmId, {
      primaryScenarioId: "base",
      urlPlanIds: null,
    });
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

    const body = ComparisonLayoutV5Schema.parse(await req.json());

    const validation = validateLayoutV5(body);
    if (!validation.ok) {
      return NextResponse.json({ errors: validation.errors }, { status: 422 });
    }

    const cellCount = body.groups.reduce((n, g) => n + g.cells.length, 0);

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
      metadata: { groupCount: body.groups.length, cellCount },
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
