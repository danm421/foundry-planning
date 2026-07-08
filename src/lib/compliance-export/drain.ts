import { and, asc, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/db";
import { complianceExportBatches, generationRuns } from "@/db/schema";
import {
  renderPresentationPdf,
  type ExportPdfBody,
} from "@/components/presentations/render-presentation-pdf";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { markDone, markFailed, STALE_RUN_MS } from "@/lib/crm/generation-runs";
import { recordAudit } from "@/lib/audit";
import { finalizeBatchIfComplete, markBatchRunning } from "./batches";
import { COMPLIANCE_RUN_KIND, COMPLIANCE_REPORT_TYPE } from "./deck";

const DEFAULT_TIME_BUDGET_MS = 8 * 60 * 1000; // < 800s route ceiling, < STALE_RUN_MS
const DEFAULT_CLAIM_SIZE = 4;

// In-flight run statuses the claim loop can NOT re-grab (it only claims
// `queued`). A run stuck in one of these past the stale cutoff was orphaned by a
// crashed / over-budget invocation and must be swept, or its batch never
// settles. `queued` is deliberately excluded — those are still claimable.
const ORPHANABLE_STATUSES = ["running", "analyzing"] as const;

type ClaimedRun = typeof generationRuns.$inferSelect;

/**
 * Claim up to `n` queued compliance runs atomically. SELECT … FOR UPDATE SKIP
 * LOCKED inside a transaction, then flip to `running`, so two overlapping cron
 * invocations never grab the same row.
 *
 * Exported (beyond the brief's internal usage) so the Step 6 live-DB harness
 * can exercise the real claim SQL directly under concurrency.
 */
export async function claimQueuedRuns(n: number): Promise<ClaimedRun[]> {
  return db.transaction(async (tx) => {
    // Full-row select under FOR UPDATE SKIP LOCKED: the lock is what makes the
    // claim atomic across overlapping invocations, so the snapshot taken here
    // is already the authoritative "claimed" set — no need for a second
    // RETURNING round-trip after the status flip below.
    const locked = await tx
      .select()
      .from(generationRuns)
      .where(and(eq(generationRuns.kind, COMPLIANCE_RUN_KIND), eq(generationRuns.status, "queued")))
      .orderBy(asc(generationRuns.createdAt))
      .limit(n)
      .for("update", { skipLocked: true });
    if (locked.length === 0) return [];
    const ids = locked.map((r) => r.id);
    await tx
      .update(generationRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(inArray(generationRuns.id, ids));
    return locked;
  });
}

async function processRun(run: ClaimedRun): Promise<"done" | "failed"> {
  if (!run.clientId) {
    await markFailed(run.id, "run has no clientId");
    return "failed";
  }
  try {
    const body = run.requestPayload as ExportPdfBody;
    const { buffer, filename } = await renderPresentationPdf(run.clientId, run.firmId, body);
    const doc = await savePlanToVault({
      clientId: run.clientId,
      firmId: run.firmId,
      reportType: COMPLIANCE_REPORT_TYPE,
      scenarioId: run.scenarioId,
      filename,
      buffer,
      uploadedBy: run.triggeredBy,
    });
    if (!doc) {
      await markFailed(run.id, "vault save failed");
      return "failed";
    }
    await recordAudit({
      action: "presentations.export_pdf",
      resourceType: "client",
      resourceId: run.clientId,
      clientId: run.clientId,
      firmId: run.firmId,
      actorId: "system:compliance-export",
      actorKind: "system",
      metadata: { via: "compliance-export", batchId: run.batchId, pages: body.pages.map((p) => p.pageId) },
    });
    await markDone(run.id, doc.id);
    return "done";
  } catch (err) {
    const msg = err instanceof Error ? err.message : "render failed";
    await markFailed(run.id, msg);
    return "failed";
  }
}

/**
 * Safety net for batches the claim loop can't advance on its own. A run left
 * `running`/`analyzing` by a crashed / over-budget invocation is never
 * re-claimed (claim only grabs `queued`), so if it was a batch's LAST
 * in-flight child the batch would sit `running` forever — and
 * `hasActiveBatchForFirm` would 409-block every future export for that firm.
 * Fail such orphaned runs past the stale cutoff, then settle any still-active
 * batch left with no in-flight children.
 *
 * The fail-sweep is a single UPDATE whose WHERE carries every guard (kind,
 * orphanable status, startedAt cutoff) — no preceding SELECT. Two things that
 * buys: (1) the cutoff is keyed on startedAt, which claimQueuedRuns stamps
 * the moment a run flips queued->running, so a run claimed just before this
 * sweep runs has a fresh startedAt even if its createdAt (queue time, for a
 * large batch) is already past the cutoff — createdAt would wrongly fail it
 * mid-render; (2) the UPDATE's own WHERE re-checks status at write time, so a
 * concurrent markDone that flips a run to `done` between when this sweep
 * decides to run and when its UPDATE executes simply won't match anymore —
 * no separate SELECT snapshot to go stale and clobber the completion.
 *
 * Runs once at the end of every drain pass (cheap, low-volume tables), so it
 * fires even when there was nothing to claim — which is exactly the stuck case.
 */
async function reconcileStuckBatches(now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STALE_RUN_MS);
  await db
    .update(generationRuns)
    .set({ status: "failed", error: "timed out", finishedAt: now })
    .where(
      and(
        eq(generationRuns.kind, COMPLIANCE_RUN_KIND),
        inArray(generationRuns.status, [...ORPHANABLE_STATUSES]),
        lt(generationRuns.startedAt, cutoff),
      ),
    );

  // Settle any active batch whose children are now all terminal. finalize
  // re-reads the child counts, so it no-ops on batches with real in-flight work.
  const active = await db
    .select({ id: complianceExportBatches.id })
    .from(complianceExportBatches)
    .where(inArray(complianceExportBatches.status, ["queued", "running"]));
  for (const b of active) {
    await finalizeBatchIfComplete(b.id);
  }
}

export async function drainComplianceExports(opts?: {
  timeBudgetMs?: number;
  claimSize?: number;
  now?: Date;
}): Promise<{ processed: number; done: number; failed: number }> {
  const timeBudgetMs = opts?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const claimSize = opts?.claimSize ?? DEFAULT_CLAIM_SIZE;
  const now = opts?.now ?? new Date();
  const deadline = Date.now() + timeBudgetMs;
  let processed = 0, done = 0, failed = 0;

  while (Date.now() < deadline) {
    const claimed = await claimQueuedRuns(claimSize);
    if (claimed.length === 0) break;

    const touchedBatches = new Set<string>();
    for (const run of claimed) {
      if (run.batchId && !touchedBatches.has(run.batchId)) {
        await markBatchRunning(run.batchId);
        touchedBatches.add(run.batchId);
      }
    }

    for (const run of claimed) {
      const result = await processRun(run);
      processed += 1;
      if (result === "done") done += 1;
      else failed += 1;
    }

    for (const batchId of touchedBatches) {
      await finalizeBatchIfComplete(batchId);
    }
  }

  await reconcileStuckBatches(now);
  return { processed, done, failed };
}
