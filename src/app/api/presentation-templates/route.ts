import { NextResponse } from "next/server";
import { z } from "zod";
import { formatZodIssues } from "@/lib/schemas/common";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { templatePagesSchema } from "@/lib/presentations/template-descriptor-schema";
import {
  listTemplatesForUser,
  createTemplate,
} from "@/lib/presentations/templates-repo";
import { listDismissedSlugs } from "@/lib/presentations/builtin-templates-repo";
import { partitionBuiltInRows } from "@/lib/presentations/builtin-templates";

export const dynamic = "force-dynamic";

export async function GET(_request: Request) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) throw new UnauthorizedError();
    const [{ shared, mine }, dismissed] = await Promise.all([
      listTemplatesForUser(firmId, userId),
      listDismissedSlugs(firmId, userId),
    ]);
    const { builtIn, builtInHidden } = partitionBuiltInRows(dismissed);
    return NextResponse.json({ shared, mine, builtIn, builtInHidden });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/presentation-templates failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const PostBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  visibility: z.enum(["shared", "private"]),
  pages: templatePagesSchema,
});

export async function POST(request: Request) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) throw new UnauthorizedError();

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = PostBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", issues: formatZodIssues(parsed.error) }, { status: 400 });
    }

    let created;
    try {
      created = await createTemplate({
        firmId,
        createdByUserId: userId,
        name: parsed.data.name,
        visibility: parsed.data.visibility,
        pages: parsed.data.pages,
      });
    } catch (e) {
      if (e instanceof Error && /unique/i.test(e.message)) {
        return NextResponse.json({ error: "A template with that name already exists" }, { status: 409 });
      }
      throw e;
    }

    await recordAudit({
      action: "presentation_template.create",
      resourceType: "presentation_template",
      resourceId: created.id,
      firmId,
      metadata: { name: created.name, visibility: created.visibility, pageCount: created.pages.length },
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/presentation-templates failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
