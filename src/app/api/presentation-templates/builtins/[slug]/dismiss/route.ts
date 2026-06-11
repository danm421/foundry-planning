import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { BUILTIN_SLUGS, BUILTIN_ID_PREFIX } from "@/lib/presentations/builtin-templates";
import {
  dismissBuiltin,
  restoreBuiltin,
} from "@/lib/presentations/builtin-templates-repo";

export const dynamic = "force-dynamic";

async function resolve(params: Promise<{ slug: string }>) {
  const firmId = await requireOrgId();
  const { userId } = await auth();
  if (!userId) throw new UnauthorizedError();
  const { slug } = await params;
  return { firmId, userId, slug };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { firmId, userId, slug } = await resolve(params);
    if (!BUILTIN_SLUGS.has(slug)) {
      return NextResponse.json({ error: "Unknown built-in template" }, { status: 404 });
    }
    await dismissBuiltin(firmId, userId, slug);
    await recordAudit({
      action: "presentation_template.dismiss_builtin",
      resourceType: "presentation_template",
      resourceId: `${BUILTIN_ID_PREFIX}${slug}`,
      firmId,
      metadata: { slug },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/presentation-templates/builtins/[slug]/dismiss failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { firmId, userId, slug } = await resolve(params);
    if (!BUILTIN_SLUGS.has(slug)) {
      return NextResponse.json({ error: "Unknown built-in template" }, { status: 404 });
    }
    await restoreBuiltin(firmId, userId, slug);
    await recordAudit({
      action: "presentation_template.restore_builtin",
      resourceType: "presentation_template",
      resourceId: `${BUILTIN_ID_PREFIX}${slug}`,
      firmId,
      metadata: { slug },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/presentation-templates/builtins/[slug]/dismiss failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
