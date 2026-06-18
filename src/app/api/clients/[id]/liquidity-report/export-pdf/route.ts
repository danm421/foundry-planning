import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { recordCompletedRun } from "@/lib/crm/generation-runs";
import { auth, currentUser } from "@clerk/nextjs/server";
import {
  checkExportPdfRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { runProjectionWithEvents } from "@/engine/projection";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { YearlyLiquidityPdfDocument } from "@/components/yearly-liquidity-report-pdf/document";
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import type { ClientData } from "@/engine/types";
import React from "react";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

    // CRM contacts — sole identity source.
    const contactRows = await db
      .select()
      .from(crmHouseholdContacts)
      .where(eq(crmHouseholdContacts.householdId, client.crmHouseholdId));
    const primaryContact = contactRows.find((c) => c.role === "primary");
    const spouseContact = contactRows.find((c) => c.role === "spouse");
    if (!primaryContact?.dateOfBirth) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const clientFirstName = primaryContact.firstName;
    const clientLastName = primaryContact.lastName;
    const clientDob = primaryContact.dateOfBirth;
    const spouseFirstName = spouseContact?.firstName ?? null;
    const spouseDob = spouseContact?.dateOfBirth ?? null;

    const url = new URL(request.url);
    const body = await request.json().catch(() => ({}));

    // SSRF hardening — match balance-sheet PDF route exactly.
    const isSafePngDataUri = (v: unknown): v is string =>
      typeof v === "string" &&
      v.startsWith("data:image/png;base64,") &&
      v.length < 2_000_000;
    const chartPng: string | null = isSafePngDataUri(body.chartPng) ? body.chartPng : null;

    const scenarioParam = url.searchParams.get("scenario");
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
    const apiData = (await apiRes.json()) as ClientData;
    const projection = runProjectionWithEvents(apiData);

    const report = buildYearlyLiquidityReport({
      projection,
      clientData: apiData,
      ownerNames: {
        clientName: clientFirstName ?? "Client",
        spouseName: spouseFirstName ?? null,
      },
      ownerDobs: {
        clientDob,
        spouseDob: spouseDob ?? null,
      },
    });

    const clientName = [clientFirstName, clientLastName].filter(Boolean).join(" ") || "Client";
    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const doc = React.createElement(YearlyLiquidityPdfDocument, {
      clientName,
      generatedAt,
      report,
      chartPng,
    }) as React.ReactElement<DocumentProps>;

    const buffer = await Promise.race<Buffer>([
      renderToBuffer(doc),
      new Promise<Buffer>((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    const downloadName = `liquidity-${(clientLastName ?? "client").toLowerCase()}.pdf`;

    const vaultDoc = await savePlanToVault({
      clientId: id,
      firmId,
      reportType: "liquidity",
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
          kind: "liquidity",
          scenarioId: scenarioParam ?? null,
          triggeredBy: userId ?? null,
          triggeredByEmail: u?.emailAddresses?.[0]?.emailAddress ?? null,
          resultDocumentId: vaultDoc?.id ?? null,
        });
      }
    } catch (err) {
      console.error("[liquidity-report] run log failed (non-fatal)", err);
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
    console.error("POST liquidity export-pdf error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
