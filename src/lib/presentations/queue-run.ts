// src/lib/presentations/queue-run.ts
//
// A presentation deck as a queued run: a `generation_runs` row now, the render
// in after(). The app's "Generate PDF" (presentations/runs) and the Claude
// connector's generate_presentation both call queuePresentationRun, so a deck
// Claude asks for gets the same AI commentary, vault save and audit trail as
// one an advisor generates. (Forge's generate_report keeps its own lighter
// copy, which skips the commentary and the story audit.)
//
// after() keeps the caller's function alive until the render lands, up to that
// route's maxDuration — 800 s for both callers.
import { after } from "next/server";
import {
  renderPresentationPdf,
  type ExportPdfBody,
} from "@/components/presentations/render-presentation-pdf";
import { recordAudit } from "@/lib/audit";
import {
  createQueuedRun,
  markAnalyzing,
  markDone,
  markFailed,
  markRunning,
} from "@/lib/crm/generation-runs";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import {
  ensureInvestmentProposalAiSummaries,
  ensureRetirementComparisonAiSummaries,
  ensureScenarioComparisonAiSummaries,
} from "./ensure-ai-summaries";
import { unreviewedStoryChapters, type UnreviewedStoryPage } from "./story/export-gate";

type DeckPages = ExportPdfBody["pages"];

/** The Retirement Comparison, Scenario Comparison and Investment Proposal AI
 *  commentary, generated server-side and inlined into the pages before a
 *  render. A no-op for a deck with none of those pages. */
export async function withAiSummaries(clientId: string, firmId: string, pages: DeckPages): Promise<DeckPages> {
  return ensureInvestmentProposalAiSummaries(
    clientId,
    firmId,
    await ensureScenarioComparisonAiSummaries(
      clientId,
      firmId,
      await ensureRetirementComparisonAiSummaries(clientId, firmId, pages),
    ),
  );
}

/**
 * One `plan_story.exported_unreviewed` row per Plan Story page with chapters no
 * advisor has reviewed — the soft export gate's compliance record
 * (story/export-gate.ts). Call it only after the render has landed: an audited
 * row means the deck went out. No `actorId` → recordAudit reads the session.
 */
export async function recordUnreviewedStoryAudits(args: {
  storyReview: UnreviewedStoryPage[];
  clientId: string;
  firmId: string;
  actorId?: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await Promise.all(
    args.storyReview
      .filter((page) => page.unreviewed > 0)
      .map((page) =>
        recordAudit({
          action: "plan_story.exported_unreviewed",
          resourceType: "client",
          resourceId: args.clientId,
          clientId: args.clientId,
          firmId: args.firmId,
          ...(args.actorId ? { actorId: args.actorId } : {}),
          metadata: {
            ...args.metadata,
            pageId: page.pageId,
            scenarioId: page.scenarioId,
            documentRole: page.documentRole,
            unreviewed: page.unreviewed,
            total: page.total,
          },
        }),
      ),
  );
}

export interface QueuePresentationRunArgs {
  clientId: string;
  firmId: string;
  /** The client's CRM household — where the run is listed and the deck saved. */
  householdId: string;
  body: ExportPdfBody;
  triggeredBy: string | null;
  triggeredByEmail: string | null;
  /** Omit on a web request: recordAudit then reads the actor from the session,
   *  impersonation attribution included. The connector has no session and
   *  names the advisor here. */
  auditActorId?: string;
  /** Merged into every audit row (the route passes its cross-firm stamp). */
  auditMetadata: Record<string, unknown>;
  via: "background-run" | "claude";
}

/**
 * Queue a deck: count unreviewed story chapters (the caller can warn now),
 * create the run, and render in after(). The background work never throws: a
 * failure marks the run failed and files no export audit. `runId` is null when
 * the run row couldn't be created (createQueuedRun is best-effort).
 */
export async function queuePresentationRun(
  args: QueuePresentationRunArgs,
): Promise<{ runId: string | null; storyReview: UnreviewedStoryPage[] }> {
  const { clientId, firmId, body } = args;
  const actor = args.auditActorId ? { actorId: args.auditActorId } : {};

  // Counted before the run exists so the response can carry it; audited only
  // after the render lands, beside presentations.export_pdf.
  const storyReview = await unreviewedStoryChapters(clientId, body.pages);

  const runId = await createQueuedRun({
    clientId,
    householdId: args.householdId,
    firmId,
    kind: "presentation",
    scenarioId: body.scenarioId,
    triggeredBy: args.triggeredBy,
    triggeredByEmail: args.triggeredByEmail,
    requestPayload: body,
  });

  after(async () => {
    try {
      // Phase 1 — "Analyzing…": the AI commentary, now that the run is visible
      // in Recent runs.
      await markAnalyzing(runId);
      const pages = await withAiSummaries(clientId, firmId, body.pages);
      // Phase 2 — "Running": the PDF, with the commentary inlined.
      await markRunning(runId);
      const { buffer, filename } = await renderPresentationPdf(clientId, firmId, { ...body, pages });
      const doc = await savePlanToVault({
        clientId,
        firmId,
        reportType: "presentation",
        scenarioId: body.scenarioId,
        filename,
        buffer,
        uploadedBy: args.triggeredBy,
      });
      await recordAudit({
        action: "presentations.export_pdf",
        resourceType: "client",
        resourceId: clientId,
        clientId,
        firmId,
        ...actor,
        metadata: {
          ...args.auditMetadata,
          pages: body.pages.map((p) => p.pageId),
          via: args.via,
          brand: body.brand ?? null,
        },
      });
      await recordUnreviewedStoryAudits({
        storyReview,
        clientId,
        firmId,
        actorId: args.auditActorId,
        metadata: args.auditMetadata,
      });
      await markDone(runId, doc?.id ?? null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "render failed";
      console.error("[presentations/runs] background render failed", err);
      await markFailed(runId, msg);
    }
  });

  return { runId, storyReview };
}
