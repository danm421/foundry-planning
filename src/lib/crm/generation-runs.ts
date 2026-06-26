import { and, desc, eq, inArray, lt, or } from "drizzle-orm";
import { db } from "@/db";
import { generationRuns } from "@/db/schema";

export type GenerationRunRow = typeof generationRuns.$inferSelect;

/** Runs still queued/running past this age are treated as orphaned and failed. */
export const STALE_RUN_MS = 3 * 60 * 1000;

const ERROR_MAX = 1000;

type NewRunBase = {
  clientId: string;
  householdId: string;
  firmId: string;
  kind: string;
  scenarioId: string | null;
  triggeredBy: string | null;
  triggeredByEmail: string | null;
};

function logFail(op: string, err: unknown) {
  const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown";
  console.error(`[generation-runs] ${op} failed (non-fatal):`, msg);
}

/** Insert a queued run; returns its id, or null on failure (best-effort). */
export async function createQueuedRun(
  args: NewRunBase & { requestPayload: unknown },
): Promise<string | null> {
  try {
    const [row] = await db
      .insert(generationRuns)
      .values({
        householdId: args.householdId,
        clientId: args.clientId,
        firmId: args.firmId,
        kind: args.kind,
        status: "queued",
        scenarioId: args.scenarioId,
        triggeredBy: args.triggeredBy,
        triggeredByEmail: args.triggeredByEmail,
        requestPayload: args.requestPayload ?? null,
      })
      .returning({ id: generationRuns.id });
    return row.id;
  } catch (err) {
    logFail("createQueuedRun", err);
    return null;
  }
}

/**
 * First phase of a presentation run: generating the Retirement Comparison AI
 * commentary before the PDF render. Stamps `startedAt` (the real start of work)
 * and surfaces as "Analyzing…" in Recent runs. Runs that never reach the next
 * phase are swept to `failed` by listRecentRuns just like queued/running.
 */
export async function markAnalyzing(runId: string | null): Promise<void> {
  if (!runId) return;
  try {
    await db
      .update(generationRuns)
      .set({ status: "analyzing", startedAt: new Date() })
      .where(eq(generationRuns.id, runId));
  } catch (err) {
    logFail("markAnalyzing", err);
  }
}

export async function markRunning(runId: string | null): Promise<void> {
  if (!runId) return;
  try {
    await db
      .update(generationRuns)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(generationRuns.id, runId));
  } catch (err) {
    logFail("markRunning", err);
  }
}

export async function markDone(
  runId: string | null,
  resultDocumentId: string | null,
): Promise<void> {
  if (!runId) return;
  try {
    await db
      .update(generationRuns)
      .set({ status: "done", resultDocumentId, finishedAt: new Date() })
      .where(eq(generationRuns.id, runId));
  } catch (err) {
    logFail("markDone", err);
  }
}

export async function markFailed(
  runId: string | null,
  error: string,
): Promise<void> {
  if (!runId) return;
  try {
    await db
      .update(generationRuns)
      .set({ status: "failed", error: error.slice(0, ERROR_MAX), finishedAt: new Date() })
      .where(eq(generationRuns.id, runId));
  } catch (err) {
    logFail("markFailed", err);
  }
}

/** One-shot insert born `done` — for synchronous (light) report exports. */
export async function recordCompletedRun(
  args: NewRunBase & { resultDocumentId: string | null },
): Promise<string | null> {
  try {
    const now = new Date();
    const [row] = await db
      .insert(generationRuns)
      .values({
        householdId: args.householdId,
        clientId: args.clientId,
        firmId: args.firmId,
        kind: args.kind,
        status: "done",
        scenarioId: args.scenarioId,
        triggeredBy: args.triggeredBy,
        triggeredByEmail: args.triggeredByEmail,
        resultDocumentId: args.resultDocumentId,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: generationRuns.id });
    return row.id;
  } catch (err) {
    logFail("recordCompletedRun", err);
    return null;
  }
}

/**
 * Recent runs for a household, newest first, firm-scoped. Lazily flips
 * queued/running rows older than STALE_RUN_MS to `failed` before returning,
 * so an orphaned background job (deploy / over-budget render) doesn't hang
 * in the panel forever. No cron required.
 */
export async function listRecentRuns(
  householdId: string,
  firmId: string,
  limit: number,
): Promise<GenerationRunRow[]> {
  try {
    const cutoff = new Date(Date.now() - STALE_RUN_MS);
    const stale = await db
      .select({ id: generationRuns.id })
      .from(generationRuns)
      .where(
        and(
          eq(generationRuns.householdId, householdId),
          eq(generationRuns.firmId, firmId),
          or(
            eq(generationRuns.status, "queued"),
            eq(generationRuns.status, "analyzing"),
            eq(generationRuns.status, "running"),
          ),
          lt(generationRuns.createdAt, cutoff),
        ),
      );
    if (stale.length > 0) {
      await db
        .update(generationRuns)
        .set({ status: "failed", error: "timed out", finishedAt: new Date() })
        .where(inArray(generationRuns.id, stale.map((r) => r.id)));
    }

    return await db
      .select()
      .from(generationRuns)
      .where(
        and(
          eq(generationRuns.householdId, householdId),
          eq(generationRuns.firmId, firmId),
        ),
      )
      .orderBy(desc(generationRuns.createdAt))
      .limit(limit);
  } catch (err) {
    logFail("listRecentRuns", err);
    return [];
  }
}
