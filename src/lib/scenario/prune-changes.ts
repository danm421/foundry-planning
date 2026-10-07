// src/lib/scenario/prune-changes.ts
//
// Deletes scenario_changes rows that reference a deleted base entity. Call this
// inside the same transaction as the base-row delete so the cleanup is atomic.
//
// scenario_changes.target_id has no FK constraint (the column is deliberately
// untyped so new overlayable kinds can be added without a migration). A base
// DELETE therefore leaves orphan rows whose targetId no longer resolves; the
// overlay engine then ghost-renders them in the Changes panel (F18). The
// edit/remove ops are inert against a missing base row, but the stale rows are
// confusing and accumulate as DB cruft, so prune them on delete.

import { and, eq, inArray, notInArray } from "drizzle-orm";
import type { db } from "@/db";
import { scenarioChanges, scenarios } from "@/db/schema";
import { SCENARIO_ONLY_KINDS } from "./promote-table-registry";

/** Inferred from the db.transaction callback — avoids coupling to Drizzle internals. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Deletes every scenario_changes row whose targetId equals `deletedId`, within
 * the scenarios of `clientId` (the client that owned the deleted row).
 *
 * Scoped to the client because a target id is not unique across clients: a
 * scenario add carries an id its author chose, and promoting it makes that the
 * base row's id. Scenario-only kinds are excluded — they have no base row to
 * orphan, and a stress test's id is one fixed constant shared by every
 * scenario. Call inside the same transaction as the base-row delete so the
 * prune is atomic with it.
 */
export async function pruneOrphanScenarioChanges(
  tx: Tx,
  deletedId: string,
  clientId: string,
): Promise<void> {
  await tx
    .delete(scenarioChanges)
    .where(
      and(
        eq(scenarioChanges.targetId, deletedId),
        notInArray(scenarioChanges.targetKind, [...SCENARIO_ONLY_KINDS]),
        inArray(
          scenarioChanges.scenarioId,
          tx.select({ id: scenarios.id }).from(scenarios).where(eq(scenarios.clientId, clientId)),
        ),
      ),
    );
}
