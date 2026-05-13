import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/db";
import { clients, clientComparisons, comparisonTemplates } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { extractSlots } from "@/lib/comparison/templates";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  visibility: z.enum(["private", "firm"]),
  nameByPlanId: z.record(z.string(), z.string()).optional(),
  slotLabels: z.array(z.string().min(1).max(120)).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id, cid } = await params;

    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [comparison] = await db
      .select()
      .from(clientComparisons)
      .where(
        and(
          eq(clientComparisons.id, cid),
          eq(clientComparisons.clientId, id),
          eq(clientComparisons.firmId, firmId),
        ),
      );
    if (!comparison) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = Body.parse(await req.json());

    const { layout, slotLabels: extractedLabels } = extractSlots(
      comparison.layout,
      body.nameByPlanId ?? {},
    );
    const slotLabels =
      body.slotLabels && body.slotLabels.length === extractedLabels.length
        ? body.slotLabels
        : extractedLabels;

    const [row] = await db
      .insert(comparisonTemplates)
      .values({
        firmId,
        createdByUserId: userId,
        name: body.name,
        description: body.description ?? null,
        visibility: body.visibility,
        slotCount: slotLabels.length,
        slotLabels,
        layout,
      })
      .returning();

    await recordAudit({
      action: "comparison_template.create",
      resourceType: "comparison_template",
      resourceId: row.id,
      clientId: id,
      firmId,
      metadata: { fromComparisonId: cid, visibility: body.visibility, slotCount: slotLabels.length },
    });

    return NextResponse.json({ template: row }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    if (err instanceof Error && /at most 8 unique plans/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("save-as-template error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
