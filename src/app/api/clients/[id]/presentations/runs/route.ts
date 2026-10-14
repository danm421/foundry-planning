import { NextRequest, NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { checkExportPdfRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { assertBrandChoiceAllowed } from "@/lib/branding/brand-options";
import { householdBrand } from "@/lib/branding/brand-choice";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";
import {
  BodySchema,
  renderPresentationPdf,
} from "@/components/presentations/render-presentation-pdf";
import { recordCompletedRun } from "@/lib/crm/generation-runs";
import {
  queuePresentationRun,
  recordUnreviewedStoryAudits,
  withAiSummaries,
} from "@/lib/presentations/queue-run";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { recordAudit } from "@/lib/audit";
import { unreviewedStoryChapters, InvalidStoryOptionsError } from "@/lib/presentations/story/export-gate";
import { flatLadderWarning } from "@/lib/presentations/flat-ladder-gate";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";

export const dynamic = "force-dynamic";
// after() needs budget to finish the render after the 202 response. Fluid
// Compute keeps the instance alive through after() up to maxDuration. A
// Foundation Plan deck runs a full retirement-comparison projection + LI
// solve before rendering — 60s wasn't enough on prod and the instance was
// hard-killed mid-render; the first successful run then used 292s of a 300s
// budget. 800 is the Pro-plan Fluid ceiling; headroom is free (billing is
// active CPU, not the cap). Must stay below STALE_RUN_MS (generation-runs.ts)
// or the reaper marks still-running jobs "timed out".
export const maxDuration = 800;

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

    // A picked brand must be one this caller may use (the household's own
    // needs no check). Checked before the run exists, so a refusal leaves
    // nothing in Recent runs.
    if (parsed.data.brand) {
      await assertBrandChoiceAllowed(firmId, parsed.data.brand, householdBrand(client));
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
      // The soft story gate (story/export-gate.ts): counted before the render,
      // audited only after it lands — an audited row means the deck went out.
      const storyReview = await unreviewedStoryChapters(id, parsed.data.pages);
      // Generate any Retirement Comparison, Scenario Comparison and Investment
      // Proposal AI commentary server-side first, then render — the synchronous
      // download blocks on all of them anyway.
      const pages = await withAiSummaries(id, firmId, parsed.data.pages);
      const { buffer, filename } = await renderPresentationPdf(id, firmId, {
        ...parsed.data,
        pages,
      });
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
          brand: parsed.data.brand ?? null,
        }),
      });
      await recordUnreviewedStoryAudits({
        storyReview,
        clientId: id,
        firmId,
        metadata: crossFirmAuditMeta({ access }, callerOrg),
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

    // The deck-level "Generate PDF": a queued run, rendered in after() — shared
    // with the Claude connector's generate_presentation (queue-run.ts). No
    // auditActorId: recordAudit reads the actor from this session,
    // impersonation attribution included.
    const { runId, storyReview } = await queuePresentationRun({
      clientId: id,
      firmId,
      householdId,
      body: parsed.data,
      triggeredBy: userId ?? null,
      triggeredByEmail: email,
      auditMetadata: crossFirmAuditMeta({ access }, callerOrg),
      via: "background-run",
    });

    // `storyReview` rides only on this path: the download branch's response IS
    // the PDF, already handed to the advisor by the time anything could act on
    // a warning derived from it. Here the render is still ahead of us (in
    // `after()`, above), so the launcher can show the count before the file
    // exists.
    //
    // The Early Years flat-chart note rides the same path for the same reason,
    // and is computed HERE rather than beside `storyReview` above so the
    // download branch never pays for an answer it has nowhere to put. It is
    // advice, not a compliance control, so it files no audit — and a note about
    // a deck must not be able to fail the deck, hence the catch.
    const ladderWarning = await flatLadderWarning(id, firmId, parsed.data.pages).catch(
      (err) => {
        console.error("[presentations/runs] flat-chart note failed", err);
        return null;
      },
    );
    return NextResponse.json({ runId, storyReview, ladderWarning }, { status: 202 });
  } catch (err) {
    // Render-path errors only reach here via the synchronous download branch —
    // the async after() job catches its own and marks the run failed instead.
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (err instanceof InvalidStoryOptionsError) {
      return NextResponse.json(
        { error: err.message, issues: err.issues },
        { status: 400 },
      );
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
