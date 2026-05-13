import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/db";
import { comparisonTemplates } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const PutBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  visibility: z.enum(["private", "firm"]).optional(),
  slotLabels: z.array(z.string().min(1).max(120)).optional(),
}).refine(
  (v) => v.name !== undefined || v.description !== undefined || v.visibility !== undefined || v.slotLabels !== undefined,
  { message: "no fields to update" },
);

async function loadOwnTemplate(tid: string, firmId: string, userId: string) {
  const [row] = await db
    .select()
    .from(comparisonTemplates)
    .where(
      and(
        eq(comparisonTemplates.id, tid),
        eq(comparisonTemplates.firmId, firmId),
        eq(comparisonTemplates.createdByUserId, userId),
      ),
    );
  return row ?? null;
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ tid: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { tid } = await params;

    const existing = await loadOwnTemplate(tid, firmId, userId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = PutBody.parse(await req.json());
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (body.name !== undefined) update.name = body.name;
    if (body.description !== undefined) update.description = body.description;
    if (body.visibility !== undefined) update.visibility = body.visibility;
    if (body.slotLabels !== undefined) {
      if (body.slotLabels.length !== existing.slotCount) {
        return NextResponse.json(
          { error: `slotLabels length must equal ${existing.slotCount}` },
          { status: 400 },
        );
      }
      update.slotLabels = body.slotLabels;
    }

    const [row] = await db
      .update(comparisonTemplates)
      .set(update)
      .where(eq(comparisonTemplates.id, tid))
      .returning();

    await recordAudit({
      action: "comparison_template.update",
      resourceType: "comparison_template",
      resourceId: tid,
      firmId,
      metadata: { fields: Object.keys(body) },
    });

    return NextResponse.json({ template: { ...row, editable: true } });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("PUT comparison-template error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ tid: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { tid } = await params;

    const existing = await loadOwnTemplate(tid, firmId, userId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.delete(comparisonTemplates).where(eq(comparisonTemplates.id, tid));

    await recordAudit({
      action: "comparison_template.delete",
      resourceType: "comparison_template",
      resourceId: tid,
      firmId,
      metadata: { name: existing.name },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("DELETE comparison-template error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
