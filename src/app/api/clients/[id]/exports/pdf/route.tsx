import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { renderToStream } from "@react-pdf/renderer";
import { db } from "@/db";
import { firms } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { getArtifact } from "@/lib/report-artifacts/index";
import { isSafePngDataUri } from "@/lib/report-artifacts/png-validation";
import { ArtifactDocument } from "@/components/pdf/artifact-document";
import type { ChartImage, Variant } from "@/lib/report-artifacts/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VARIANTS = ["chart", "data", "chart+data", "csv"] as const satisfies readonly Variant[];

const ChartImageSchema = z.object({
  id: z.string().min(1).max(64),
  dataUrl: z.string().refine(isSafePngDataUri, "unsafe data URL"),
  width: z.number().int().positive().max(4096),
  height: z.number().int().positive().max(4096),
  dataVersion: z.string().min(1).max(64),
});

const BodySchema = z.object({
  reportId: z.string().min(1).max(64),
  variant: z.enum(VARIANTS),
  opts: z.unknown().optional(),
  charts: z.array(ChartImageSchema).max(8).optional(),
});

const safeFilename = (s: string) => s.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "") || "export";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await params;

    const json = await request.json().catch(() => null);
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body", issues: parsed.error.issues }, { status: 400 });
    }

    const { reportId, variant, opts: rawOpts, charts: rawCharts } = parsed.data;

    const artifact = getArtifact(reportId);
    if (!artifact) {
      return NextResponse.json({ error: "Unknown reportId" }, { status: 404 });
    }
    if (!artifact.variants.includes(variant)) {
      return NextResponse.json(
        { error: `Variant '${variant}' not supported by '${reportId}'` },
        { status: 400 },
      );
    }

    const optsParse = artifact.optionsSchema.safeParse(rawOpts ?? {});
    if (!optsParse.success) {
      return NextResponse.json({ error: "Invalid options", issues: optsParse.error.issues }, { status: 400 });
    }
    const opts = optsParse.data;

    const { data, asOf } = await artifact.fetchData({ clientId, firmId, opts });

    // No drift validation in v1 — the artifact's dataVersion is a sha1 of the
    // server-side data, but the client has no way to compute the matching hash.
    // Charts pass through verbatim; PNG safety + size + count caps still apply
    // via the body schema. Real drift detection is logged in future-work.
    const charts: ChartImage[] = rawCharts ?? [];

    if (variant === "csv") {
      if (!artifact.toCsv) {
        return NextResponse.json({ error: "Report has no CSV export" }, { status: 400 });
      }
      const files = artifact.toCsv(data, opts);
      const dateSlug = asOf.toISOString().slice(0, 10);
      if (files.length === 1) {
        const f = files[0];
        return new NextResponse(f.contents, {
          status: 200,
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="${safeFilename(f.name)}"`,
            "Cache-Control": "no-store",
          },
        });
      }
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f.contents);
      const bytes = await zip.generateAsync({ type: "uint8array" });
      return new NextResponse(bytes as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${safeFilename(reportId)}-${dateSlug}.zip"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const [firm] = await db
      .select({ displayName: firms.displayName })
      .from(firms)
      .where(eq(firms.firmId, firmId));
    const firmName = firm?.displayName ?? "Foundry Planning";

    const householdName = (data as { clientName?: string }).clientName ?? "Client";

    const blocks = artifact.renderPdf({ data, opts, variant, charts });
    const stream = await Promise.race<Awaited<ReturnType<typeof renderToStream>>>([
      renderToStream(
        <ArtifactDocument
          householdName={householdName}
          artifactTitle={artifact.title}
          reportYear={asOf.getFullYear()}
          firmName={firmName}
          asOf={asOf}
        >
          {blocks}
        </ArtifactDocument>,
      ),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(reportId)}-${asOf.toISOString().slice(0, 10)}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /clients/[id]/exports/pdf failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
