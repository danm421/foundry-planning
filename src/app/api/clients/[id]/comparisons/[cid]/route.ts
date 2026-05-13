import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients, clientComparisons } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { ComparisonLayoutV5Schema } from "@/lib/comparison/layout-schema";

export const dynamic = "force-dynamic";

async function requireClientInFirm(id: string, firmId: string) {
  const [client] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
  return client ?? null;
}

async function requireComparison(cid: string, clientId: string, firmId: string) {
  const [row] = await db
    .select()
    .from(clientComparisons)
    .where(
      and(
        eq(clientComparisons.id, cid),
        eq(clientComparisons.clientId, clientId),
        eq(clientComparisons.firmId, firmId),
      ),
    );
  return row ?? null;
}

const PutBody = z.object({
  name: z.string().min(1).max(200).optional(),
  layout: ComparisonLayoutV5Schema.optional(),
}).refine((v) => v.name !== undefined || v.layout !== undefined, {
  message: "must include name or layout",
});

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, cid } = await params;
    const client = await requireClientInFirm(id, firmId);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const row = await requireComparison(cid, id, firmId);
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ comparison: row });
  } catch (err) {
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("GET comparison error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, cid } = await params;
    const client = await requireClientInFirm(id, firmId);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = await requireComparison(cid, id, firmId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = PutBody.parse(await req.json());
    const update: { name?: string; layout?: typeof existing.layout; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (body.name !== undefined) update.name = body.name;
    if (body.layout !== undefined) update.layout = body.layout;

    const [row] = await db
      .update(clientComparisons)
      .set(update)
      .where(eq(clientComparisons.id, cid))
      .returning();

    await recordAudit({
      action: "client_comparison.update",
      resourceType: "client_comparison",
      resourceId: cid,
      clientId: id,
      firmId,
      metadata: { fields: Object.keys(body) },
    });

    return NextResponse.json({ comparison: row });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("PUT comparison error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, cid } = await params;
    const client = await requireClientInFirm(id, firmId);
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const existing = await requireComparison(cid, id, firmId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(clientComparisons).where(eq(clientComparisons.id, cid));

    await recordAudit({
      action: "client_comparison.delete",
      resourceType: "client_comparison",
      resourceId: cid,
      clientId: id,
      firmId,
      metadata: { name: existing.name },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("DELETE comparison error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
