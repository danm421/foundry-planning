// src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getOrgId } from "@/lib/db-helpers";
import { runProjection } from "@/engine/projection";
import { renderToStream } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { BalanceSheetPdfDocument } from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";
import { buildViewModel } from "@/components/balance-sheet-report/view-model";
import type { OwnershipView } from "@/components/balance-sheet-report/ownership-filter";
import React from "react";

const VIEW_LABELS: Record<OwnershipView, string> = {
  consolidated: "Consolidated",
  client: "Client only",
  spouse: "Spouse only",
  joint: "Joint only",
  entities: "Entities only",
};

function isOwnershipView(v: string): v is OwnershipView {
  return v === "consolidated" || v === "client" || v === "spouse" || v === "joint" || v === "entities";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await getOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const viewParam = url.searchParams.get("view") ?? "consolidated";
    if (!Number.isFinite(year)) return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    if (!isOwnershipView(viewParam)) return NextResponse.json({ error: "Invalid view" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const donutPng: string | null = typeof body.donutPng === "string" ? body.donutPng : null;
    const barPng: string | null = typeof body.barPng === "string" ? body.barPng : null;

    // Pull projection data the same way the page does by hitting the API.
    // Using an internal fetch avoids duplicating the projection-data query.
    const apiRes = await fetch(`${url.origin}/api/clients/${id}/projection-data`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
    });
    if (!apiRes.ok) {
      return NextResponse.json({ error: "Failed to load projection data" }, { status: 500 });
    }
    const apiData = await apiRes.json();
    const projectionYears = runProjection(apiData);

    const viewModel = buildViewModel({
      accounts: apiData.accounts,
      liabilities: apiData.liabilities,
      projectionYears,
      selectedYear: year,
      view: viewParam,
    });

    const clientName = [client.firstName, client.lastName].filter(Boolean).join(" ") || "Client";
    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const doc = React.createElement(BalanceSheetPdfDocument, {
      clientName,
      asOfYear: year,
      viewLabel: VIEW_LABELS[viewParam],
      generatedAt,
      viewModel,
      donutPng,
      barPng,
    }) as React.ReactElement<DocumentProps>;

    const stream = await renderToStream(doc);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="balance-sheet-${(client.lastName ?? "client").toLowerCase()}-${year}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("POST balance-sheet export-pdf error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
