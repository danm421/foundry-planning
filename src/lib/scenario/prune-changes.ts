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

import { eq } from "drizzle-orm";
import type { db } from "@/db";
import { scenarioChanges } from "@/db/schema";

/** Inferred from the db.transaction callback — avoids coupling to Drizzle internals. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Deletes every scenario_changes row whose targetId equals `deletedId`.
 *
 * Because UUIDs are globally unique, no extra clientId scoping is needed — a
 * targetId cannot collide across tenants. Call inside the same transaction as
 * the base-row delete so the prune is atomic with it.
 */
export async function pruneOrphanScenarioChanges(
  tx: Tx,
  deletedId: string,
): Promise<void> {
  await tx.delete(scenarioChanges).where(eq(scenarioChanges.targetId, deletedId));
}
