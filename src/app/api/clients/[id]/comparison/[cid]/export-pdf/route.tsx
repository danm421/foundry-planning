import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { renderToStream } from "@react-pdf/renderer";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { isSafePngDataUri } from "@/lib/report-artifacts/png-validation";
import { loadExportData } from "@/lib/comparison-pdf/load-export-data";
import { buildCoverProps } from "@/lib/comparison-pdf/build-cover";
import { ComparisonPdfDocument } from "@/components/comparison-pdf/document";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
// Defense-in-depth on top of the 25 s render-timeout race below: cap the
// whole route well below Vercel's default (300 s) so a pathological
// projection-data fetch can't pin a function instance for minutes.
export const maxDuration = 60;

const ChartImageMap = z
  .record(z.string(), z.string().refine(isSafePngDataUri, "unsafe data URL"))
  .default({});

const BodySchema = z.object({
  chartImages: ChartImageMap,
});

const slugify = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "");

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cid: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, cid } = await params;

    let json: unknown;
    try {
      json = await req.json();
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
    const { chartImages } = parsed.data;

    const data = await loadExportData({ clientId: id, firmId, comparisonId: cid });
    if (!data) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const cover = buildCoverProps({
      layout: data.layout,
      client: data.client,
      branding: data.branding,
      advisorName: data.advisorName,
      asOf: data.asOf,
    });

    const doc = (
      <ComparisonPdfDocument
        layout={data.layout}
        cover={cover}
        plans={data.plans}
        mc={null}
        branding={data.branding}
        chartImages={chartImages}
        reportYear={data.asOf.getUTCFullYear()}
      />
    );

    // @react-pdf/renderer has a memory-leak history on large docs, and
    // a malformed layout could send it into an unbounded paginate loop.
    // Race the render against a 25 s timeout so a pathological PDF can
    // never pin the serverless function to its maxDuration.
    const stream = await Promise.race<Awaited<ReturnType<typeof renderToStream>>>([
      renderToStream(doc),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    const filename =
      (slugify(data.client.lastName) || "client") +
      "-" +
      (slugify(data.layout.title) || "comparison-export") +
      "-" +
      data.asOf.toISOString().slice(0, 10) +
      ".pdf";

    await recordAudit({
      action: "comparison.export_pdf",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: { comparisonId: cid, chartImagesCount: Object.keys(chartImages).length },
    });

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (
      err instanceof UnauthorizedError ||
      (err instanceof Error && err.name === "UnauthorizedError")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /clients/[id]/comparison/[cid]/export-pdf failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
