import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { generationRuns } from "@/db/schema";
import {
  renderPresentationPdf,
  type ExportPdfBody,
} from "@/components/presentations/render-presentation-pdf";
import { savePlanToVault } from "@/lib/crm/vault-plans";
import { markDone, markFailed } from "@/lib/crm/generation-runs";
import { recordAudit } from "@/lib/audit";
import { finalizeBatchIfComplete, markBatchRunning } from "./batches";
import { COMPLIANCE_RUN_KIND, COMPLIANCE_REPORT_TYPE } from "./deck";

const DEFAULT_TIME_BUDGET_MS = 8 * 60 * 1000; // < 800s route ceiling, < STALE_RUN_MS
const DEFAULT_CLAIM_SIZE = 4;

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

export async function drainComplianceExports(opts?: {
  timeBudgetMs?: number;
  claimSize?: number;
  now?: Date;
}): Promise<{ processed: number; done: number; failed: number }> {
  const timeBudgetMs = opts?.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  const claimSize = opts?.claimSize ?? DEFAULT_CLAIM_SIZE;
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

  return { processed, done, failed };
}
