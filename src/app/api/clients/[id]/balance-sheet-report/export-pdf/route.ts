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
import { deriveLegacyOwnership } from "@/components/balance-sheet-report/derive-ownership";
import type { FamilyMember } from "@/engine/types";
import React from "react";

export const dynamic = "force-dynamic";

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
    // SSRF hardening: @react-pdf/renderer fetches any URL passed as Image src,
     // which would reach IMDS and internal hosts. Accept only data: PNG URIs
     // with a hard size cap.
    const isSafePngDataUri = (v: unknown): v is string =>
      typeof v === "string" &&
      v.startsWith("data:image/png;base64,") &&
      v.length < 2_000_000;
    const donutPng: string | null = isSafePngDataUri(body.donutPng) ? body.donutPng : null;
    const barPng: string | null = isSafePngDataUri(body.barPng) ? body.barPng : null;

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

    const entityRows = await db.select().from(entitiesTable).where(eq(entitiesTable.clientId, id));
    const entityInfos = entityRows.map((e) => ({
      id: e.id,
      name: e.name,
      entityType: e.entityType,
    }));

    const roleById = new Map<string, FamilyMember["role"]>(
      ((apiData.familyMembers ?? []) as FamilyMember[]).map((fm) => [fm.id, fm.role]),
    );
    const mappedAccounts = apiData.accounts.map((a: { id: string; name: string; category: string; owners: Parameters<typeof deriveLegacyOwnership>[0] }) => {
      const { owner, ownerEntityId } = deriveLegacyOwnership(a.owners ?? [], roleById);
      return {
        id: a.id,
        name: a.name,
        category: a.category,
        owner: owner ?? "client",
        ownerEntityId,
      } as const;
    });
    const mappedLiabilities = apiData.liabilities.map((l: { id: string; name: string; owners: Parameters<typeof deriveLegacyOwnership>[0]; linkedPropertyId?: string | null }) => {
      const { owner, ownerEntityId } = deriveLegacyOwnership(l.owners ?? [], roleById);
      return {
        id: l.id,
        name: l.name,
        owner,
        ownerEntityId,
        linkedPropertyId: l.linkedPropertyId ?? null,
      } as const;
    });

    const viewModel = buildViewModel({
      accounts: mappedAccounts,
      liabilities: mappedLiabilities,
      entities: entityInfos,
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
