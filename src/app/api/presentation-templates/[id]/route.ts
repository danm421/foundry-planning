import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { templatePagesSchema } from "@/lib/presentations/template-descriptor-schema";
import {
  getTemplateById,
  updateTemplate,
  deleteTemplate,
} from "@/lib/presentations/templates-repo";

export const dynamic = "force-dynamic";

const PatchBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  visibility: z.enum(["shared", "private"]).optional(),
  pages: templatePagesSchema.optional(),
}).refine((b) => b.name !== undefined || b.visibility !== undefined || b.pages !== undefined, {
  message: "At least one field is required",
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) throw new UnauthorizedError();
    const { id } = await params;

    const existing = await getTemplateById(id, firmId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.createdByUserId !== userId) {
      return NextResponse.json({ error: "Only the creator can edit this template" }, { status: 403 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = PatchBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", issues: parsed.error.issues }, { status: 400 });
    }

    let updated;
    try {
      updated = await updateTemplate(id, firmId, parsed.data);
    } catch (e) {
      if (e instanceof Error && /unique/i.test(e.message)) {
        return NextResponse.json({ error: "A template with that name already exists" }, { status: 409 });
      }
      throw e;
    }
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await recordAudit({
      action: "presentation_template.update",
      resourceType: "presentation_template",
      resourceId: id,
      firmId,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return NextResponse.json(updated);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PATCH /api/presentation-templates/[id] failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) throw new UnauthorizedError();
    const { id } = await params;

    const existing = await getTemplateById(id, firmId);
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (existing.createdByUserId !== userId) {
      return NextResponse.json({ error: "Only the creator can delete this template" }, { status: 403 });
    }

    await deleteTemplate(id, firmId);

    await recordAudit({
      action: "presentation_template.delete",
      resourceType: "presentation_template",
      resourceId: id,
      firmId,
      metadata: { name: existing.name, visibility: existing.visibility },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/presentation-templates/[id] failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
