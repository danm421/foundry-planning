// src/app/api/clients/[id]/risk/export-pdf/route.ts
import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { auth, currentUser } from "@clerk/nextjs/server";
import { requireClientAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkExportPdfRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { getOrComputeCapacity, type CapacityResult } from "@/lib/risk/capacity";
import { getRiskProfileDetail, summarizeEvent, nullActorLabel } from "@/lib/risk/queries";
import { resolveMismatchState } from "@/lib/risk/detail-mismatch";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { resolveBrandingForClient } from "@/lib/branding/resolve-for-client";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { recordCompletedRun } from "@/lib/crm/generation-runs";
import { recordAudit } from "@/lib/audit";
import { slugForFilename } from "@/lib/filename-slug";
import {
  RiskProfilePdfDocument,
  type RiskEventLine,
} from "@/components/risk-profile-pdf/risk-profile-pdf-document";

export const dynamic = "force-dynamic";
// Defense-in-depth on top of the 25 s render-timeout race below: cap the whole
// route well below Vercel's default (300 s) so a pathological capacity
// recompute can't pin a function instance for minutes.
export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { client, firmId } = await requireClientAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const rl = await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many PDF exports. Please wait a moment and try again.",
      );
    }

    // A household with no plan throws here -- that is the "no capacity yet"
    // state the document renders, not an error. Same guard the detail page uses.
    let capacity: CapacityResult | null = null;
    try {
      capacity = await getOrComputeCapacity({ clientId: id, firmId });
    } catch {
      capacity = null;
    }

    // Read AFTER getOrComputeCapacity so the row reflects whatever that call
    // just recomputed and wrote -- the page does the same.
    const { row, flags, events } = await getRiskProfileDetail(id);

    const [mismatch, actors, branding] = await Promise.all([
      resolveMismatchState({ clientId: id, firmId, compositeLevel: row.compositeLevel }),
      resolveActors(
        Array.from(
          new Set(events.map((e) => e.actorUserId).filter((v): v is string => v !== null)),
        ),
      ),
      resolveBrandingForClient(firmId, client.advisorId),
    ]);

    const eventLines: RiskEventLine[] = events.map((e) => ({
      id: e.id,
      date: new Date(e.occurredAt).toISOString().slice(0, 10),
      summary: summarizeEvent(e),
      actor: e.actorUserId
        ? (actors.get(e.actorUserId)?.name ?? "Former member")
        : nullActorLabel(e.kind),
    }));

    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    const doc = React.createElement(RiskProfilePdfDocument, {
      row,
      flags,
      factors: capacity?.factors ?? null,
      mismatch,
      events: eventLines,
      generatedAt,
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
    const downloadName = `risk-profile-${slugForFilename(row.householdName)}-${date}.pdf`;

    const vaultDoc = await savePlanToVault({
      clientId: id,
      firmId,
      reportType: "risk_profile",
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
          kind: "risk_profile",
          scenarioId: null,
          triggeredBy: userId ?? null,
          triggeredByEmail: u?.emailAddresses?.[0]?.emailAddress ?? null,
          resultDocumentId: vaultDoc?.id ?? null,
        });
      }
    } catch (err) {
      console.error("[risk export-pdf] run log failed (non-fatal)", err);
    }

    await recordAudit({
      action: "risk_profile.export_pdf",
      resourceType: "risk_profile",
      resourceId: id,
      clientId: id,
      firmId,
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
    console.error("POST risk export-pdf error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
