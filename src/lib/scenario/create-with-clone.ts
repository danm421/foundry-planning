// src/lib/scenario/create-with-clone.ts
//
// Creates a new scenario row for a client and (optionally) clones the toggle
// groups + scenario_changes from a source scenario in the same client.
//
// Why a shared helper: both `POST /api/clients/[id]/scenarios` (create from
// base/empty/explicit-source) and `POST /api/clients/[id]/scenarios/[sid]`
// (duplicate the current scenario) need the same insert + clone logic. Keeping
// it here lets the duplicate route call the helper directly instead of
// proxying back to the create route via `fetch`, which would lose the request
// context (cookies/clerk session) on the internal hop.
//
// Auth/scope checks (firmId membership, sourceId belongs to client) are the
// caller's responsibility — the helper trusts what it's handed and just runs
// the inserts inside a single transaction.
//
// Cascade behavior on rollback: if the transaction fails partway through the
// clone, the scenarios row + its scenario_changes / scenario_toggle_groups
// rows are all rolled back together (Postgres tx). No half-cloned scenarios.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  scenarioChanges,
  scenarioToggleGroups,
  scenarios,
} from "@/db/schema";

export type CreateWithCloneSource =
  | { kind: "empty" }
  | { kind: "base" }
  | { kind: "scenario"; sourceId: string };

export interface CreateWithCloneArgs {
  clientId: string;
  name: string;
  source: CreateWithCloneSource;
}

export interface CreateWithCloneResult {
  scenario: typeof scenarios.$inferSelect;
}

/**
 * Insert a new scenario row and (when `source.kind !== "empty"`) clone the
 * source scenario's toggle groups + scenario_changes into it. Toggle group ids
 * are remapped via a fresh-uuid map so `requires_group_id` self-references
 * point at the clones (not the originals); `toggle_group_id` on each change
 * row is remapped through the same map.
 *
 * `source.kind === "base"` resolves to the client's `is_base_case = true`
 * scenario; if there isn't one (shouldn't happen — the auto-create migration
 * from Plan 1 guarantees one), the helper falls back to "empty".
 *
 * Wrapped in a single `db.transaction` so partial-clone failures roll back the
 * scenarios insert too — callers always observe atomic create-or-fail.
 */
export async function createScenarioWithClone(
  args: CreateWithCloneArgs,
): Promise<CreateWithCloneResult> {
  const { clientId, name, source } = args;

  return await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(scenarios)
      .values({ clientId, name, isBaseCase: false })
      .returning();

    if (source.kind === "empty") {
      return { scenario: created };
    }

    // Resolve the source scenario id.
    let sourceId: string | null = null;
    if (source.kind === "base") {
      const [baseRow] = await tx
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(
          and(
            eq(scenarios.clientId, clientId),
            eq(scenarios.isBaseCase, true),
          ),
        );
      sourceId = baseRow?.id ?? null;
    } else {
      // Caller is expected to have already verified the sourceId belongs to
      // this client + firm. We re-check the clientId match defensively to
      // avoid cross-client clones if the caller forgets.
      const [srcRow] = await tx
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(
          and(
            eq(scenarios.id, source.sourceId),
            eq(scenarios.clientId, clientId),
          ),
        );
      sourceId = srcRow?.id ?? null;
    }

    if (!sourceId) {
      // Nothing to clone — return the empty scenario rather than failing.
      return { scenario: created };
    }

    // Clone toggle groups first so we can remap their ids before cloning the
    // changes that reference them.
    const srcGroups = await tx
      .select()
      .from(scenarioToggleGroups)
      .where(eq(scenarioToggleGroups.scenarioId, sourceId));

    const idMap = new Map<string, string>();
    for (const g of srcGroups) idMap.set(g.id, crypto.randomUUID());

    if (srcGroups.length > 0) {
      await tx.insert(scenarioToggleGroups).values(
        srcGroups.map((g) => ({
          id: idMap.get(g.id)!,
          scenarioId: created.id,
          name: g.name,
          defaultOn: g.defaultOn,
          // Remap self-reference; if the parent isn't in the map (shouldn't
          // happen since we just collected every group), drop it to null.
          requiresGroupId: g.requiresGroupId
            ? idMap.get(g.requiresGroupId) ?? null
            : null,
          orderIndex: g.orderIndex,
        })),
      );
    }

    const srcChanges = await tx
      .select()
      .from(scenarioChanges)
      .where(eq(scenarioChanges.scenarioId, sourceId));

    if (srcChanges.length > 0) {
      await tx.insert(scenarioChanges).values(
        srcChanges.map((c) => ({
          scenarioId: created.id,
          opType: c.opType,
          targetKind: c.targetKind,
          targetId: c.targetId,
          payload: c.payload,
          toggleGroupId: c.toggleGroupId
            ? idMap.get(c.toggleGroupId) ?? null
            : null,
          orderIndex: c.orderIndex,
        })),
      );
    }

    return { scenario: created };
  });
}
