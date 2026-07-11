// src/app/api/clients/[id]/tax-returns/[taxYear]/export-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { crmHouseholdContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkExportPdfRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { getTaxReturn } from "@/lib/tax-returns/store";
import { parseRowFacts } from "@/lib/tax-returns/db";
import { buildAnalysisForFacts, parseYear } from "@/lib/tax-returns/assemble-analysis";
import { resolveBranding } from "@/lib/branding/branding";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { recordCompletedRun } from "@/lib/crm/generation-runs";
import { recordAudit } from "@/lib/audit";
import { auth, currentUser } from "@clerk/nextjs/server";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { TaxAnalysisPdfDocument } from "@/components/tax-analysis-pdf/tax-analysis-pdf-document";
import React from "react";

export const dynamic = "force-dynamic";
// Defense-in-depth on top of the 25 s render-timeout race below: cap the
// whole route well below Vercel's default (300 s) so a pathological render
// can't pin a function instance for minutes.
export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; taxYear: string }> },
) {
  try {
    await requireOrgId();
    const { id, taxYear: rawYear } = await params;
    const taxYear = parseYear(rawYear);
    if (taxYear == null) return NextResponse.json({ error: "Invalid tax year" }, { status: 400 });

    const { client, firmId } = await requireClientAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const rl = await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many PDF exports. Please wait a moment and try again.",
      );
    }

    const row = await getTaxReturn(id, taxYear);
    if (!row || row.status !== "ready") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const { facts } = parseRowFacts(row);
    if (!facts) {
      return NextResponse.json({ error: "Tax return facts unavailable" }, { status: 404 });
    }

    // CRM contacts (source of client name for the PDF, same as the
    // balance-sheet-report export route), the tax analysis, and firm branding
    // are all independent — run them concurrently instead of awaiting the CRM
    // lookup before starting the rest.
    const [primaryContactRows, analysis, branding] = await Promise.all([
      client.crmHouseholdId
        ? db
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
        : Promise.resolve([]),
      buildAnalysisForFacts(id, taxYear, facts),
      resolveBranding(firmId),
    ]);
    const [primaryContact] = primaryContactRows;
    const clientName = [primaryContact?.firstName, primaryContact?.lastName].filter(Boolean).join(" ") || "Client";

    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const doc = React.createElement(TaxAnalysisPdfDocument, {
      clientName,
      taxYear,
      generatedAt,
      analysis,
      firmName: branding.firmName,
      logoDataUrl: branding.logoDataUrl,
    }) as React.ReactElement<DocumentProps>;

    const buffer = await Promise.race<Buffer>([
      renderToBuffer(doc),
      new Promise<Buffer>((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    const date = new Date().toISOString().slice(0, 10);
    const downloadName = `tax-analysis-${taxYear}-${date}.pdf`;

    const vaultDoc = await savePlanToVault({
      clientId: id,
      firmId,
      reportType: "tax_analysis",
      scenarioId: null,
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
          kind: "tax_analysis",
          scenarioId: null,
          triggeredBy: userId ?? null,
          triggeredByEmail: u?.emailAddresses?.[0]?.emailAddress ?? null,
          resultDocumentId: vaultDoc?.id ?? null,
        });
      }
    } catch (err) {
      console.error("[tax-analysis export-pdf] run log failed (non-fatal)", err);
    }

    await recordAudit({
      action: "tax_return.export_pdf",
      resourceType: "tax_return",
      resourceId: `${id}:${taxYear}`,
      clientId: id,
      firmId,
      metadata: { taxYear },
    });

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
    console.error("POST tax-returns export-pdf error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
