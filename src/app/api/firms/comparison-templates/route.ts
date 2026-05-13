import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, or } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { db } from "@/db";
import { comparisonTemplates } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { ComparisonLayoutV5Schema } from "@/lib/comparison/layout-schema";
import { PRESETS } from "@/lib/comparison/templates";

export const dynamic = "force-dynamic";

const CreateBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  visibility: z.enum(["private", "firm"]),
  slotLabels: z.array(z.string().min(1).max(120)),
  layout: ComparisonLayoutV5Schema,
});

export async function GET() {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rows = await db
      .select()
      .from(comparisonTemplates)
      .where(
        and(
          eq(comparisonTemplates.firmId, firmId),
          or(
            eq(comparisonTemplates.visibility, "firm"),
            and(
              eq(comparisonTemplates.visibility, "private"),
              eq(comparisonTemplates.createdByUserId, userId),
            ),
          ),
        ),
      )
      .orderBy(asc(comparisonTemplates.name));

    return NextResponse.json({
      presets: PRESETS.map((p) => ({
        key: p.key,
        name: p.name,
        description: p.description,
        slotCount: p.slotCount,
        slotLabels: p.slotLabels,
      })),
      templates: rows.map((r) => ({
        ...r,
        editable: r.createdByUserId === userId,
      })),
    });
  } catch (err) {
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("GET comparison-templates error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = CreateBody.parse(await req.json());

    const [row] = await db
      .insert(comparisonTemplates)
      .values({
        firmId,
        createdByUserId: userId,
        name: body.name,
        description: body.description ?? null,
        visibility: body.visibility,
        slotCount: body.slotLabels.length,
        slotLabels: body.slotLabels,
        layout: body.layout,
      })
      .returning();

    await recordAudit({
      action: "comparison_template.create",
      resourceType: "comparison_template",
      resourceId: row.id,
      firmId,
      metadata: { source: "direct-create", visibility: body.visibility },
    });

    return NextResponse.json({ template: { ...row, editable: true } }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const a = authErrorResponse(err);
    if (a) return NextResponse.json(a.body, { status: a.status });
    console.error("POST comparison-templates error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
