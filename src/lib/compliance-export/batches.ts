import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { complianceExportBatches, generationRuns } from "@/db/schema";
import { COMPLIANCE_RUN_KIND } from "./deck";

export type ComplianceBatchRow = typeof complianceExportBatches.$inferSelect;
export type SkippedClient = { householdId: string; name: string; reason: string };
export type ChildCounts = {
  queued: number;
  running: number;
  analyzing: number;
  done: number;
  failed: number;
};

const ACTIVE_STATUSES = ["queued", "running"] as const;

export async function createBatch(args: {
  firmId: string;
  triggeredBy: string | null;
  triggeredByEmail: string | null;
  totalClients: number;
  deckSpec: unknown;
  skippedClients: SkippedClient[];
}): Promise<string> {
  const [row] = await db
    .insert(complianceExportBatches)
    .values({
      firmId: args.firmId,
      status: "queued",
      triggeredBy: args.triggeredBy,
      triggeredByEmail: args.triggeredByEmail,
      totalClients: args.totalClients,
      deckSpec: args.deckSpec,
      skippedClients: args.skippedClients,
    })
    .returning({ id: complianceExportBatches.id });
  return row.id;
}

export async function getBatchForFirm(
  batchId: string,
  firmId: string,
): Promise<ComplianceBatchRow | null> {
  const [row] = await db
    .select()
    .from(complianceExportBatches)
    .where(and(eq(complianceExportBatches.id, batchId), eq(complianceExportBatches.firmId, firmId)))
    .limit(1);
  return row ?? null;
}

export async function listBatchesForFirm(
  firmId: string,
  limit: number,
): Promise<ComplianceBatchRow[]> {
  return db
    .select()
    .from(complianceExportBatches)
    .where(eq(complianceExportBatches.firmId, firmId))
    .orderBy(desc(complianceExportBatches.createdAt))
    .limit(limit);
}

export async function hasActiveBatchForFirm(firmId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: complianceExportBatches.id })
    .from(complianceExportBatches)
    .where(
      and(
        eq(complianceExportBatches.firmId, firmId),
        inArray(complianceExportBatches.status, [...ACTIVE_STATUSES]),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function childStatusCounts(batchId: string): Promise<ChildCounts> {
  const rows = await db
    .select({ status: generationRuns.status, count: sql<number>`count(*)::int` })
    .from(generationRuns)
    .where(and(eq(generationRuns.batchId, batchId), eq(generationRuns.kind, COMPLIANCE_RUN_KIND)))
    .groupBy(generationRuns.status);
  const c: ChildCounts = { queued: 0, running: 0, analyzing: 0, done: 0, failed: 0 };
  for (const r of rows) {
    if (r.status in c) c[r.status as keyof ChildCounts] = r.count;
  }
  return c;
}

export async function markBatchRunning(batchId: string): Promise<void> {
  await db
    .update(complianceExportBatches)
    .set({ status: "running", startedAt: sql`COALESCE(${complianceExportBatches.startedAt}, now())` })
    .where(and(eq(complianceExportBatches.id, batchId), eq(complianceExportBatches.status, "queued")));
}

/** When no child run is still in flight, settle the batch (done / done_with_errors). */
export async function finalizeBatchIfComplete(batchId: string): Promise<void> {
  const c = await childStatusCounts(batchId);
  const inFlight = c.queued + c.running + c.analyzing;
  if (inFlight > 0) return;
  const status = c.failed > 0 ? "done_with_errors" : "done";
  await db
    .update(complianceExportBatches)
    .set({ status, finishedAt: new Date() })
    .where(eq(complianceExportBatches.id, batchId));
}
