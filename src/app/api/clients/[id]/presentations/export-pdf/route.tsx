import { NextRequest, NextResponse } from "next/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import {
  checkPreviewPdfRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";
import { recordAudit } from "@/lib/audit";
import { renderPresentationPdf, BodySchema } from "@/components/presentations/render-presentation-pdf";

export const dynamic = "force-dynamic";
// Defense-in-depth on top of the 25 s render-timeout race below: cap the
// whole route well below Vercel's default (300 s) so a pathological
// projection can't pin a function instance for minutes.
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();

    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    if (!parsed.data.preview) {
      return NextResponse.json(
        { error: "Use POST /presentations/runs to generate a saved deck." },
        { status: 400 },
      );
    }

    const rl = await checkPreviewPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many previews. Please wait a moment and try again.",
      );
    }

    const { buffer, filename, distinctScenarioCount } =
      await renderPresentationPdf(id, firmId, parsed.data);

    await recordAudit({
      action: "presentations.preview_pdf",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: {
        pages: parsed.data.pages.map((p) => p.pageId),
        scenarioId: parsed.data.scenarioId,
        hasOverrides: parsed.data.pages.some((p) => p.scenarioOverride !== undefined),
        distinctScenarioCount,
      },
    });

    const safeFilename = filename.replace(/["\\\r\n;]/g, "");
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${safeFilename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof ProjectionInputError) {
      return NextResponse.json(
        { error: "Client data is incomplete or invalid for this projection." },
        { status: 422 },
      );
    }
    if (err instanceof Error && /Too many .* scenarios/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (
      err instanceof UnauthorizedError ||
      (err instanceof Error && err.name === "UnauthorizedError")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /clients/[id]/presentations/export-pdf failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
