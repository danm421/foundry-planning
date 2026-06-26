import { NextRequest, NextResponse, after } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkExportPdfRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  BodySchema,
  renderPresentationPdf,
} from "@/components/presentations/render-presentation-pdf";
import {
  createQueuedRun,
  markRunning,
  markDone,
  markFailed,
  recordCompletedRun,
} from "@/lib/crm/generation-runs";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { recordAudit } from "@/lib/audit";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";

export const dynamic = "force-dynamic";
// after() needs budget to finish the render after the 202 response. Fluid
// Compute keeps the instance alive through after() up to maxDuration.
export const maxDuration = 60;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { client, firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const householdId = client.crmHouseholdId;
    if (!householdId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", issues: parsed.error.issues },
        { status: 400 },
      );
    }

    const rl = await checkExportPdfRateLimit(firmId);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many PDF exports. Please wait a moment and try again.",
      );
    }

    const { userId } = await auth();
    let email: string | null = null;
    try {
      const u = await currentUser();
      email = u?.emailAddresses?.[0]?.emailAddress ?? null;
    } catch {
      // non-fatal — leave email null
    }

    // Synchronous download mode (per-page "Download" button): render now and
    // stream the PDF straight back as an attachment, AND persist a copy to the
    // vault + Recent runs — one render shared by both. The deck-level
    // "Generate PDF" omits this flag and takes the async after()/202 path below
    // (heavy multi-page decks can exceed the response budget).
    if (new URL(request.url).searchParams.get("download") === "1") {
      const { buffer, filename } = await renderPresentationPdf(id, firmId, parsed.data);
      // Both helpers are best-effort (swallow their own failures) so a vault or
      // run-bookkeeping hiccup never blocks the advisor's download.
      const doc = await savePlanToVault({
        clientId: id,
        firmId,
        reportType: "presentation",
        scenarioId: parsed.data.scenarioId,
        filename,
        buffer,
        uploadedBy: userId ?? null,
      });
      await recordCompletedRun({
        clientId: id,
        householdId,
        firmId,
        kind: "presentation",
        scenarioId: parsed.data.scenarioId,
        triggeredBy: userId ?? null,
        triggeredByEmail: email,
        resultDocumentId: doc?.id ?? null,
      });
      await recordAudit({
        action: "presentations.export_pdf",
        resourceType: "client",
        resourceId: id,
        clientId: id,
        firmId,
        metadata: crossFirmAuditMeta({ access }, callerOrg, {
          pages: parsed.data.pages.map((p) => p.pageId),
          via: "sync-download",
        }),
      });
      const safeFilename = filename.replace(/["\\\r\n;]/g, "");
      return new NextResponse(buffer as unknown as BodyInit, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${safeFilename}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    }

    const runId = await createQueuedRun({
      clientId: id,
      householdId,
      firmId,
      kind: "presentation",
      scenarioId: parsed.data.scenarioId,
      triggeredBy: userId ?? null,
      triggeredByEmail: email,
      requestPayload: parsed.data,
    });

    after(async () => {
      try {
        await markRunning(runId);
        const { buffer, filename } = await renderPresentationPdf(id, firmId, parsed.data);
        const doc = await savePlanToVault({
          clientId: id,
          firmId,
          reportType: "presentation",
          scenarioId: parsed.data.scenarioId,
          filename,
          buffer,
          uploadedBy: userId ?? null,
        });
        await recordAudit({
          action: "presentations.export_pdf",
          resourceType: "client",
          resourceId: id,
          clientId: id,
          firmId,
          metadata: crossFirmAuditMeta({ access }, callerOrg, { pages: parsed.data.pages.map((p) => p.pageId), via: "background-run" }),
        });
        await markDone(runId, doc?.id ?? null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "render failed";
        console.error("[presentations/runs] background render failed", err);
        await markFailed(runId, msg);
      }
    });

    return NextResponse.json({ runId }, { status: 202 });
  } catch (err) {
    // Render-path errors only reach here via the synchronous download branch —
    // the async after() job catches its own and marks the run failed instead.
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof ProjectionInputError) {
      return NextResponse.json(
        { error: "Client data is incomplete or invalid for this projection." },
        { status: 422 },
      );
    }
    if (err instanceof Error && /Too many .* scenarios/.test(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /clients/[id]/presentations/runs failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
