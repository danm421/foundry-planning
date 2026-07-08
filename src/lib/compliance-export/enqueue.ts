import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholds, scenarios, generationRuns } from "@/db/schema";
import { createBatch, finalizeBatchIfComplete, type SkippedClient } from "./batches";
import {
  buildComplianceRequestPayload,
  buildCompliancePages,
  COMPLIANCE_RUN_KIND,
} from "./deck";

async function resolveBaseCaseScenarioId(clientId: string): Promise<string | null> {
  // Household is already firm-scoped by the enumeration query, so a direct
  // client-scoped lookup is safe (no visibility layer needed).
  const [row] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)))
    .limit(1);
  return row?.id ?? null;
}

export async function enqueueFirmComplianceExport(args: {
  firmId: string;
  triggeredBy: string | null;
  triggeredByEmail: string | null;
  now: Date;
}): Promise<{ batchId: string; total: number; skipped: number }> {
  const households = await db.query.crmHouseholds.findMany({
    where: and(
      eq(crmHouseholds.firmId, args.firmId),
      eq(crmHouseholds.status, "active"),
      isNull(crmHouseholds.deletedAt),
    ),
    columns: { id: true, name: true },
    with: { planningClient: { columns: { id: true } } },
  });

  const skipped: SkippedClient[] = [];
  const renderable: Array<{ householdId: string; clientId: string; scenarioId: string }> = [];

  for (const h of households) {
    const clientId = h.planningClient?.id ?? null;
    if (!clientId) {
      skipped.push({ householdId: h.id, name: h.name, reason: "no planning client" });
      continue;
    }
    const scenarioId = await resolveBaseCaseScenarioId(clientId);
    if (!scenarioId) {
      skipped.push({ householdId: h.id, name: h.name, reason: "no base-case scenario" });
      continue;
    }
    renderable.push({ householdId: h.id, clientId, scenarioId });
  }

  // One transaction for the whole write section: batch row + child runs
  // commit together (or not at all), so a mid-loop insert failure can't leave
  // a partial batch that a later drain would finalize `done` with fewer
  // children than totalClients — a silently-short compliance export. It also
  // closes the childless window where a concurrent reconcile could finalize
  // the batch before its first run exists. The reads above stay outside.
  return db.transaction(async (tx) => {
    const batchId = await createBatch(
      {
        firmId: args.firmId,
        triggeredBy: args.triggeredBy,
        triggeredByEmail: args.triggeredByEmail,
        totalClients: renderable.length,
        deckSpec: buildCompliancePages(args.now),
        skippedClients: skipped,
      },
      tx,
    );

    // If every household was skipped, no child runs are ever inserted, so the
    // cron drain (which only ever looks at queued/running/analyzing children)
    // would never touch this batch — it would sit `queued` forever and the
    // active-batch guard would block all future exports for the firm. Settle
    // it immediately instead.
    if (renderable.length === 0) {
      await finalizeBatchIfComplete(batchId, tx);
      return { batchId, total: 0, skipped: skipped.length };
    }

    for (const r of renderable) {
      await tx.insert(generationRuns).values({
        householdId: r.householdId,
        clientId: r.clientId,
        firmId: args.firmId,
        kind: COMPLIANCE_RUN_KIND,
        status: "queued",
        scenarioId: r.scenarioId,
        triggeredBy: args.triggeredBy,
        triggeredByEmail: args.triggeredByEmail,
        requestPayload: buildComplianceRequestPayload(r.scenarioId, args.now),
        batchId,
      });
    }

    return { batchId, total: renderable.length, skipped: skipped.length };
  });
}
