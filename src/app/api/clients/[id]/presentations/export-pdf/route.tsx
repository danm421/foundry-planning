import { NextRequest, NextResponse } from "next/server";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import {
  checkExportPdfRateLimit,
  checkPreviewPdfRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";
import { recordAudit } from "@/lib/audit";
import { savePlanToVault } from "@/lib/crm/vault-plans";
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

    const isPreview = parsed.data.preview;
    const rl = isPreview
      ? await checkPreviewPdfRateLimit(firmId)
      : await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        isPreview
          ? "Too many previews. Please wait a moment and try again."
          : "Too many PDF exports. Please wait a moment and try again.",
      );
    }

    const { buffer, filename, distinctScenarioCount } =
      await renderPresentationPdf(id, firmId, parsed.data);

    await recordAudit({
      action: isPreview ? "presentations.preview_pdf" : "presentations.export_pdf",
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

    // Best-effort vault capture — never on previews, never blocks the download path.
    if (!isPreview) {
      await savePlanToVault({
        clientId: id,
        firmId,
        reportType: "presentation",
        scenarioId: parsed.data.scenarioId,
        filename,
        buffer,
      });
    }

    const safeFilename = filename.replace(/["\\\r\n;]/g, "");
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isPreview ? "inline" : "attachment"}; filename="${safeFilename}"`,
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
