// src/app/api/crm/households/[id]/meeting-prep/export/route.ts
//
// Renders ONE meeting-prep document per call from the advisor-edited AI draft.
// Deterministic blocks (tasks, accounts, vitals) are re-derived server-side
// here — the client never supplies data rows. Files the PDF into the
// household's "Meeting Prep" folder (uploadCrmDocument logs activity + audit)
// and returns it for download.
import { NextRequest, NextResponse } from "next/server";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { z } from "zod";
import { currentUser } from "@clerk/nextjs/server";
import { requireCrmHouseholdAccess } from "@/lib/crm/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkExportPdfRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import {
  AgendaDraftSchema,
  MeetingPrepSetupSchema,
  PrepBriefDraftSchema,
} from "@/lib/crm/meeting-prep/schemas";
import { loadMeetingPrepBattery } from "@/lib/crm/meeting-prep/battery";
import { buildMeetingPrepPdfModel } from "@/components/meeting-prep-pdf/view-model";
import { PrepBriefDocument } from "@/components/meeting-prep-pdf/prep-brief-document";
import { AgendaDocument } from "@/components/meeting-prep-pdf/agenda-document";
import { ensureMeetingPrepFolder } from "@/lib/crm/folders";
import { uploadCrmDocument } from "@/lib/crm/documents";
import { foundryDefaultLogoDataUrl } from "@/lib/presentations/default-logo";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ExportBodySchema = z.discriminatedUnion("doc", [
  z.object({ doc: z.literal("brief"), setup: MeetingPrepSetupSchema, brief: PrepBriefDraftSchema }),
  z.object({ doc: z.literal("agenda"), setup: MeetingPrepSetupSchema, agenda: AgendaDraftSchema }),
]);

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "household";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { household, orgId } = await requireCrmHouseholdAccess(id);
    await requireActiveSubscriptionForFirm(orgId);

    const rl = await checkExportPdfRateLimit(orgId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many PDF exports. Please wait a moment and try again.");
    }

    const parsed = ExportBodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid export payload" }, { status: 400 });
    }
    const body = parsed.data;

    // Fresh deterministic data as-of export time.
    const battery = await loadMeetingPrepBattery(id, orgId, {
      windowStartOverride: body.setup.windowStart,
    });

    const u = await currentUser().catch(() => null);
    const preparedBy = u ? [u.firstName, u.lastName].filter(Boolean).join(" ") || null : null;
    const generatedAt = new Date().toLocaleString("en-US", {
      year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
    const model = buildMeetingPrepPdfModel({ battery, setup: body.setup, preparedBy, generatedAt });

    const doc =
      body.doc === "brief"
        ? (React.createElement(PrepBriefDocument, { model, draft: body.brief }) as React.ReactElement<DocumentProps>)
        : (React.createElement(AgendaDocument, {
            model,
            draft: body.agenda,
            logoDataUrl: await foundryDefaultLogoDataUrl().catch(() => null),
          }) as React.ReactElement<DocumentProps>);

    const buffer = await Promise.race<Buffer>([
      renderToBuffer(doc),
      new Promise<Buffer>((_, reject) =>
        setTimeout(() => reject(new Error("PDF render timed out")), 25_000),
      ),
    ]);

    const kindLabel = body.doc === "brief" ? "meeting-prep-brief" : "meeting-agenda";
    const filename = `${kindLabel}-${slug(household.name)}-${body.setup.meetingDate}.pdf`;

    // File it in the household's Documents (uploadCrmDocument enforces vault
    // access and records the document_uploaded activity + crm.document.create audit).
    const folderId = await ensureMeetingPrepFolder(id, orgId);
    const file = new File([new Uint8Array(buffer)], filename, { type: "application/pdf" });
    await uploadCrmDocument(id, file, {
      folderId,
      description:
        body.doc === "brief"
          ? `Meeting prep brief for ${body.setup.meetingDate} (AI-assisted)`
          : `Client meeting agenda for ${body.setup.meetingDate} (AI-assisted)`,
    });

    // Distinct from uploadCrmDocument's own crm.document.create audit — this
    // one records the meeting-prep export action itself (actorId omitted so
    // recordAudit resolves it from the session, mirroring documents.ts).
    await recordAudit({
      action: "crm.meeting_prep.export",
      resourceType: "crm_household",
      resourceId: id,
      firmId: orgId,
      metadata: { doc: body.doc, meetingDate: body.setup.meetingDate, filename },
    });

    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // Mirrors the sibling meeting-prep/runs route: requireCrmHouseholdAccess
    // throws a plain Error for a missing/inaccessible household, which
    // authErrorResponse does NOT recognize — explicit 404 branch ahead of it.
    if (
      err instanceof Error &&
      err.message.startsWith("CRM household not found or access denied")
    ) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST meeting-prep export error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
