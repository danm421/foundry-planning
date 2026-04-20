import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, reportComments } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";

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

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    const reportKey = request.nextUrl.searchParams.get("reportKey");
    if (!reportKey) return NextResponse.json({ error: "reportKey is required" }, { status: 400 });

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const [row] = await db
      .select()
      .from(reportComments)
      .where(and(
        eq(reportComments.clientId, id),
        eq(reportComments.scenarioId, scenarioId),
        eq(reportComments.reportKey, reportKey),
      ));

    return NextResponse.json(row ?? { body: "" });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/report-comments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;
    const body = await request.json();
    const reportKey: string | undefined = body.reportKey;
    const commentBody: string | undefined = body.body;
    if (!reportKey) return NextResponse.json({ error: "reportKey is required" }, { status: 400 });
    if (typeof commentBody !== "string") return NextResponse.json({ error: "body must be a string" }, { status: 400 });

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) return NextResponse.json({ error: "Client not found" }, { status: 404 });

    const [existing] = await db
      .select()
      .from(reportComments)
      .where(and(
        eq(reportComments.clientId, id),
        eq(reportComments.scenarioId, scenarioId),
        eq(reportComments.reportKey, reportKey),
      ));

    if (existing) {
      const [updated] = await db
        .update(reportComments)
        .set({ body: commentBody, updatedAt: new Date() })
        .where(eq(reportComments.id, existing.id))
        .returning();
      return NextResponse.json(updated);
    }

    const [inserted] = await db
      .insert(reportComments)
      .values({ clientId: id, scenarioId, reportKey, body: commentBody })
      .returning();
    return NextResponse.json(inserted);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/report-comments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
