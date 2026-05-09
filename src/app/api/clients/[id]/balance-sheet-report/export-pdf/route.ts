// src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, entities as entitiesTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { runProjection } from "@/engine/projection";
import { renderToStream } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { BalanceSheetPdfDocument } from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";
import { buildViewModel } from "@/components/balance-sheet-report/view-model";
import type { OwnershipView } from "@/components/balance-sheet-report/ownership-filter";
import type { FamilyMember } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import React from "react";
import { isSafePngDataUri } from "@/lib/report-artifacts/png-validation";

export const dynamic = "force-dynamic";
// Defense-in-depth on top of the 25 s render-timeout race below: cap the
// whole route well below Vercel's default (300 s) so a pathological
// projection-data fetch can't pin a function instance for minutes.
export const maxDuration = 60;

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
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const viewParam = url.searchParams.get("view") ?? "consolidated";
    const asOfParam = url.searchParams.get("asOf") ?? "eoy";
    const asOfMode: "today" | "eoy" = asOfParam === "today" ? "today" : "eoy";
    if (!Number.isFinite(year)) return NextResponse.json({ error: "Invalid year" }, { status: 400 });
    if (!isOwnershipView(viewParam)) return NextResponse.json({ error: "Invalid view" }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const donutPng: string | null = isSafePngDataUri(body.donutPng) ? body.donutPng : null;
    const barPng: string | null = isSafePngDataUri(body.barPng) ? body.barPng : null;

    // Pull projection data the same way the page does by hitting the API.
    // Using an internal fetch avoids duplicating the projection-data query.
    // 30s abort leaves headroom for the 25s render race below within the
    // 60s maxDuration cap.
    const apiRes = await fetch(`${url.origin}/api/clients/${id}/projection-data`, {
      headers: { cookie: request.headers.get("cookie") ?? "" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!apiRes.ok) {
      return NextResponse.json({ error: "Failed to load projection data" }, { status: 500 });
    }
    const apiData = await apiRes.json();
    const projectionYears = runProjection(apiData);

    // The projection-data API already emits entities with `value`, `owners`,
    // and `isIrrevocable`; merge them with the canonical name + type.
    const entityRows = await db.select().from(entitiesTable).where(eq(entitiesTable.clientId, id));
    const apiEntities = (apiData.entities ?? []) as Array<{
      id: string;
      isIrrevocable?: boolean;
      value?: number;
      owners?: Array<{ familyMemberId: string; percent: number }>;
    }>;
    const entityInfos = entityRows.map((e) => {
      const fromApi = apiEntities.find((x) => x.id === e.id);
      return {
        id: e.id,
        name: e.name,
        entityType: e.entityType,
        isIrrevocable: fromApi?.isIrrevocable,
        value: fromApi?.value,
        owners: fromApi?.owners,
      };
    });

    const familyMembers = (apiData.familyMembers ?? []) as FamilyMember[];
    const mappedAccounts = (apiData.accounts as Array<{
      id: string;
      name: string;
      category: string;
      owners: AccountOwner[];
    }>).map((a) => ({
      id: a.id,
      name: a.name,
      category: a.category,
      owners: a.owners ?? [],
    }));
    const mappedLiabilities = (apiData.liabilities as Array<{
      id: string;
      name: string;
      owners: AccountOwner[];
      linkedPropertyId?: string | null;
    }>).map((l) => ({
      id: l.id,
      name: l.name,
      owners: l.owners ?? [],
      linkedPropertyId: l.linkedPropertyId ?? null,
    }));

    const viewModel = buildViewModel({
      accounts: mappedAccounts,
      liabilities: mappedLiabilities,
      entities: entityInfos,
      familyMembers,
      projectionYears,
      selectedYear: year,
      view: viewParam,
      asOfMode,
    });

    const clientName = [client.firstName, client.lastName].filter(Boolean).join(" ") || "Client";
    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const asOfLabel = asOfMode === "today" ? "Today" : `End of ${year}`;

    const doc = React.createElement(BalanceSheetPdfDocument, {
      clientName,
      asOfLabel,
      viewLabel: VIEW_LABELS[viewParam],
      generatedAt,
      viewModel,
      donutPng,
      barPng,
    }) as React.ReactElement<DocumentProps>;

    // @react-pdf/renderer has a memory-leak history on large docs, and
     // a malformed view model can send it into an unbounded layout loop.
     // Race the render against a 25 s timeout so a pathological PDF can
     // never pin the serverless function to its maxDuration.
    const stream = await Promise.race<Awaited<ReturnType<typeof renderToStream>>>([
      renderToStream(doc),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000)
      ),
    ]);

    return new NextResponse(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="balance-sheet-${(client.lastName ?? "client").toLowerCase()}-${year}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST balance-sheet export-pdf error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
