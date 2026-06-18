// src/app/api/clients/[id]/balance-sheet-report/export-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmHouseholdContacts, entities as entitiesTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { recordCompletedRun } from "@/lib/crm/generation-runs";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  checkExportPdfRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { runProjection } from "@/engine/projection";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { BalanceSheetPdfDocument } from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";
import { buildViewModel } from "@/components/balance-sheet-report/view-model";
import type { OwnershipView } from "@/components/balance-sheet-report/ownership-filter";
import type { FamilyMember } from "@/engine/types";
import type { AccountOwner, EntityOwner } from "@/engine/ownership";
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
  entities: "Trusts only",
};

function isOwnershipView(v: string): v is OwnershipView {
  return v === "consolidated" || v === "client" || v === "spouse" || v === "joint" || v === "entities";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { client, firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const rl = await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many PDF exports. Please wait a moment and try again.",
      );
    }

    // CRM contacts — source of client name for the PDF.
    const [primaryContact] = client.crmHouseholdId
      ? await db
          .select({
            firstName: crmHouseholdContacts.firstName,
            lastName: crmHouseholdContacts.lastName,
          })
          .from(crmHouseholdContacts)
          .where(
            and(
              eq(crmHouseholdContacts.householdId, client.crmHouseholdId),
              eq(crmHouseholdContacts.role, "primary"),
            ),
          )
      : [];
    const clientFirstName = primaryContact?.firstName;
    const clientLastName = primaryContact?.lastName;

    const url = new URL(request.url);
    const year = Number(url.searchParams.get("year"));
    const viewParam = url.searchParams.get("view") ?? "consolidated";
    const asOfParam = url.searchParams.get("asOf") ?? "eoy";
    const scenarioParam = url.searchParams.get("scenario");
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
    const projectionUrl = scenarioParam
      ? `${url.origin}/api/clients/${id}/projection-data?scenario=${encodeURIComponent(scenarioParam)}`
      : `${url.origin}/api/clients/${id}/projection-data`;
    const apiRes = await fetch(projectionUrl, {
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
      owners?: EntityOwner[];
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

    const clientName = [clientFirstName, clientLastName].filter(Boolean).join(" ") || "Client";
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

    const buffer = await Promise.race<Buffer>([
      renderToBuffer(doc),
      new Promise<Buffer>((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    const downloadName = `balance-sheet-${(clientLastName ?? "client").toLowerCase()}-${year}.pdf`;

    const vaultDoc = await savePlanToVault({
      clientId: id,
      firmId,
      reportType: "balance_sheet",
      scenarioId: scenarioParam,
      filename: downloadName,
      buffer,
    });
    try {
      const householdId = client.crmHouseholdId;
      if (householdId) {
        const { userId } = await auth();
        const u = await currentUser().catch(() => null);
        await recordCompletedRun({
          clientId: id,
          householdId,
          firmId,
          kind: "balance_sheet",
          scenarioId: scenarioParam ?? null,
          triggeredBy: userId ?? null,
          triggeredByEmail: u?.emailAddresses?.[0]?.emailAddress ?? null,
          resultDocumentId: vaultDoc?.id ?? null,
        });
      }
    } catch (err) {
      console.error("[balance-sheet-report] run log failed (non-fatal)", err);
    }

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST balance-sheet export-pdf error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
