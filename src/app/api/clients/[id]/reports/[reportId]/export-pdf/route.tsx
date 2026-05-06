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
import { runProjection } from "@/engine/projection";
import { renderToStream } from "@react-pdf/renderer";
import { ReportPdfDocument } from "@/components/reports-pdf/document";
import {
  collectScopesFromTree,
  loadDataForScopes,
  buildWidgetData,
} from "@/lib/reports/data-loader";
import { deriveLegacyOwnership } from "@/components/balance-sheet-report/derive-ownership";
import type { FamilyMember } from "@/engine/types";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  chartImages: z.record(z.string(), z.string()).optional(),
});

const isSafePngDataUri = (v: unknown): v is string =>
  typeof v === "string" &&
  v.startsWith("data:image/png;base64,") &&
  v.length < 2_000_000;

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

    const body = Body.parse(await request.json().catch(() => ({})));
    const sanitized: Record<string, string> = {};
    for (const [k, v] of Object.entries(body.chartImages ?? {})) {
      if (isSafePngDataUri(v)) sanitized[k] = v;
    }

    const apiRes = await fetch(
      `${new URL(request.url).origin}/api/clients/${id}/projection-data`,
      { headers: { cookie: request.headers.get("cookie") ?? "" } },
    );
    if (!apiRes.ok) {
      const upstreamBody = await apiRes.text().catch(() => "");
      console.error("POST export-pdf: projection-data fetch failed", {
        firmId,
        clientId,
        reportId: reportIdLocal,
        status: apiRes.status,
        body: upstreamBody.slice(0, 500),
      });
      return NextResponse.json(
        { error: "Failed to load projection data" },
        { status: 502 },
      );
    }
    const apiData = await apiRes.json();
    const projection = runProjection(apiData);

    // Bridge engine `owners[]` → legacy `{ owner, ownerEntityId }` shape that
    // the balance-sheet view-model still consumes (used by balanceSheetTable).
    // Mirrors the same mapping in `balance-sheet-report/export-pdf/route.ts`.
    const roleById = new Map<string, FamilyMember["role"]>(
      ((apiData.familyMembers ?? []) as FamilyMember[]).map((fm) => [
        fm.id,
        fm.role,
      ]),
    );
    type WithOwners = {
      id: string;
      name: string;
      owners: Parameters<typeof deriveLegacyOwnership>[0];
    };
    const mappedAccounts = (
      apiData.accounts as (WithOwners & { category: string })[]
    ).map((a) => {
      const { owner, ownerEntityId } = deriveLegacyOwnership(
        a.owners ?? [],
        roleById,
      );
      return {
        id: a.id,
        name: a.name,
        category: a.category,
        owner: owner ?? "client",
        ownerEntityId,
      };
    });
    const mappedLiabilities = (
      apiData.liabilities as (WithOwners & { linkedPropertyId?: string | null })[]
    ).map((l) => {
      const { owner, ownerEntityId } = deriveLegacyOwnership(
        l.owners ?? [],
        roleById,
      );
      return {
        id: l.id,
        name: l.name,
        owner,
        ownerEntityId,
        linkedPropertyId: l.linkedPropertyId ?? null,
      };
    });
    // EntitySummary.name and .entityType are optional in the engine type but
    // required by the view-model. Fall back to safe defaults so the widget
    // still renders even when the engine emits a sparse summary.
    const entityInfos = (
      (apiData.entities ?? []) as Array<{
        id: string;
        name?: string;
        entityType?: string;
      }>
    ).map((e) => ({
      id: e.id,
      name: e.name ?? "",
      entityType: e.entityType ?? "other",
    }));

    const pages = report.pages as Parameters<
      typeof ReportPdfDocument
    >[0]["pages"];
    const scopes = collectScopesFromTree(pages);
    const scopeData = await loadDataForScopes(scopes, {
      client: { id },
      projection,
    });
    const widgetData = buildWidgetData(pages, {
      projection,
      scopeData,
      client: { id },
      accounts: mappedAccounts,
      liabilities: mappedLiabilities,
      entities: entityInfos,
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
        chartImages={sanitized}
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
    // Zod errors get 400; everything else gets 500
    if (err instanceof z.ZodError) {
      console.warn("POST export-pdf: invalid body", {
        firmId,
        clientId,
        reportId: reportIdLocal,
        issues: err.issues,
      });
      return NextResponse.json(
        { error: "Invalid request body", issues: err.issues },
        { status: 400 },
      );
    }
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
