// src/app/api/clients/[id]/reports/[reportId]/export-pdf/route.ts
//
// POST: render the named report as a PDF and stream it back. The route
// is the only place that touches engine + DB + @react-pdf in one
// breath; helpers (`isSafePngDataUri`, `Body` zod) stay inline by
// design. Real per-widget data shaping lives behind the data-loader
// stubs (Task 14 fills those in).

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, reports } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { renderToStream } from "@react-pdf/renderer";
import { ReportPdfDocument } from "@/components/reports-pdf/document";
import { loadReportWidgetData } from "@/lib/reports/load-widget-data";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; reportId: string }> },
) {
  let firmId: string | undefined;
  let clientId: string | undefined;
  let reportIdLocal: string | undefined;
  try {
    firmId = await requireOrgId();
    const { id, reportId } = await params;
    clientId = id;
    reportIdLocal = reportId;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const [report] = await db
      .select()
      .from(reports)
      .where(
        and(
          eq(reports.id, reportId),
          eq(reports.clientId, id),
          eq(reports.firmId, firmId),
        ),
      );
    if (!report) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const pages = report.pages as Parameters<
      typeof ReportPdfDocument
    >[0]["pages"];
    const widgetData = await loadReportWidgetData({
      clientId: id,
      firmId,
      pages,
      dateOfBirth: client.dateOfBirth,
      retirementAge: client.retirementAge,
      comparisonBinding: report.comparisonBinding,
    });

    const householdName =
      [client.firstName, client.lastName].filter(Boolean).join(" ") || "Client";
    const firmName = "Foundry Planning";

    const doc = (
      <ReportPdfDocument
        pages={pages}
        householdName={householdName}
        reportTitle={report.title}
        reportYear={new Date().getFullYear()}
        firmName={firmName}
        widgetData={widgetData}
      />
    );

    // TODO: when the timeout wins, renderToStream's promise stays pending and the
    // stream is unconsumed. @react-pdf/renderer doesn't currently expose cancellation;
    // revisit when the SDK adds an AbortController-friendly path.
    const stream = await Promise.race<
      Awaited<ReturnType<typeof renderToStream>>
    >([
      renderToStream(doc),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${report.title
          .toLowerCase()
          .replace(/\W+/g, "-")}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("POST export-pdf failed", {
      firmId,
      clientId,
      reportId: reportIdLocal,
      err,
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
