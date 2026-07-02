// src/lib/scenario/promote-to-base.ts
//
// Orchestrates promoting a scenario to the base case:
//   1. capture the scenario's effective tree (target T) + raw changes/groups + base tree
//   2. snapshot the current base (safety net; created before the tx, compensating
//      delete on tx failure)
//   3. in ONE transaction: replay the overlay onto the base rows, copy the
//      scenario-scoped direct tables, resolve toggle-gated notes, delete all
//      non-base scenarios (DB cascade clears their overlay rows), and invalidate
//      the base's compute cache
//   4. audit
//
// The base scenario's UUID never changes (no is_base_case flag-swap), so the ~40
// `is_base_case` consumer lookups keep working untouched.
//
// SELF-CHECK DEFERRAL (see spec §"Transaction sequence" step 4 + plan Task 10 NOTE):
// The spec calls for an in-transaction equivalence self-check that re-resolves the
// base and deep-compares it to T, rolling back on mismatch. That requires reading
// the just-written base rows through the tx handle AND bypassing the React
// `cache()` memoization on `loadEffectiveTree` — both of which need a tx/uncached
// executor threaded through the cache()-wrapped `loadClientDataWithContext` and its
// sub-loaders (a broad core-loader refactor, out of scope for this change). For v1
// the safety guarantee is the ATOMIC transaction (any DB error — constraint,
// coercion, FK — rolls the whole promote back; a partial promote is never
// observable). The full effective-tree equivalence (re-resolved base == captured
// target T, via `compareEffectiveTrees`) is asserted by the live-Neon integration
// test post-commit. Wiring the runtime self-check is tracked as future-work.
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioComputeCache, scenarioSnapshots } from "@/db/schema";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { createSnapshot } from "@/lib/scenario/snapshot";
import { recordAudit } from "@/lib/audit";
import type { ToggleState } from "@/engine/scenario/types";
import { assertAccountsInClient } from "@/lib/db-scoping";
import {
  scenarioChangesToBaseWrites,
  collectExternalDedicatedAccountIds,
} from "./scenario-changes-to-base-writes";
import { executeBaseWritePlan } from "./execute-base-write-plan";
import {
  copyFlowOverridesToBase,
  copyGiftSeriesToBase,
  resolveToggleGatedNotesOnBase,
} from "./promote-direct-tables";

export interface PromoteArgs {
  clientId: string;
  firmId: string;
  scenarioId: string;
  scenarioName: string;
  toggleState: ToggleState;
  userId: string;
  /** YYYY-MM-DD, supplied by the route (engine/helper code must not compute dates). */
  dateLabel: string;
}

export interface PromoteResult {
  snapshotId: string;
  deletedScenarioCount: number;
  counts: Record<string, number>;
  notes: { kept: number; dropped: number };
}

export class PromoteError extends Error {
  constructor(
    public code: "no_base" | "invalid_ref",
    message: string,
  ) {
    super(message);
    this.name = "PromoteError";
  }
}

export async function promoteScenarioToBase(args: PromoteArgs): Promise<PromoteResult> {
  const { clientId, firmId, scenarioId, scenarioName, toggleState, userId, dateLabel } = args;

  // Resolve the base scenario id (its UUID is the stable anchor we promote into).
  const [baseRow] = await db
    .select({ id: scenarios.id })
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));
  if (!baseRow) throw new PromoteError("no_base", "Client has no base case scenario");
  const baseScenarioId = baseRow.id;

  // 1. Capture target tree + raw overlay + current base tree (all via module db,
  //    before the write transaction).
  const [{ effectiveTree: baseTree }, changes, groups] = await Promise.all([
    loadEffectiveTree(clientId, firmId, "base", {}),
    loadScenarioChanges(scenarioId),
    loadScenarioToggleGroups(scenarioId),
  ]);

  // 2. Snapshot the old base (outside the tx; compensating delete on tx failure).
  const snapshot = await createSnapshot({
    clientId,
    firmId,
    leftRef: { kind: "scenario", id: "base", toggleState: {} },
    rightRef: { kind: "scenario", id: scenarioId, toggleState },
    name: `Pre-promote: ${scenarioName} — ${dateLabel}`,
    sourceKind: "manual",
    userId,
  });

  let counts: Record<string, number> = {};
  let deletedScenarioCount = 0;
  let notes = { kept: 0, dropped: 0 };
  try {
    const plan = scenarioChangesToBaseWrites(baseTree, changes, groups, toggleState);

    // Tenant guard: expense_dedicated_accounts.account_id is a GLOBAL FK (no
    // tenant column), so every dedicated-account id not satisfied by an
    // in-batch account insert must already belong to this client — otherwise
    // a crafted id could link another firm's account (or FK-crash the txn).
    // Mirrors save-to-base's pre-transaction guard.
    const dedicatedCheck = await assertAccountsInClient(
      clientId,
      collectExternalDedicatedAccountIds(plan),
    );
    if (!dedicatedCheck.ok) throw new PromoteError("invalid_ref", dedicatedCheck.reason);

    await db.transaction(async (tx) => {
      counts = await executeBaseWritePlan(tx, plan, { clientId, baseScenarioId });
      await copyFlowOverridesToBase(tx, { clientId, scenarioId, baseScenarioId });
      await copyGiftSeriesToBase(tx, { clientId, scenarioId, baseScenarioId });
      notes = await resolveToggleGatedNotesOnBase(tx, {
        clientId,
        baseScenarioId,
        toggleState,
        groups,
      });

      // Delete every non-base scenario (cascade clears their overlay rows,
      // including the promoted scenario's now-redundant changes/groups).
      const deleted = await tx
        .delete(scenarios)
        .where(and(eq(scenarios.clientId, clientId), ne(scenarios.id, baseScenarioId)))
        .returning({ id: scenarios.id });
      deletedScenarioCount = deleted.length;

      // Invalidate the base's stale compute cache after the rewrite.
      await tx
        .delete(scenarioComputeCache)
        .where(eq(scenarioComputeCache.scenarioId, baseScenarioId));
    });
  } catch (err) {
    // Compensating cleanup: the snapshot was created before the tx, so a failed
    // promote should not leave a stray snapshot behind.
    await db
      .delete(scenarioSnapshots)
      .where(eq(scenarioSnapshots.id, snapshot.id))
      .catch(() => {});
    throw err;
  }

  await recordAudit({
    action: "scenario.promote_to_base",
    resourceType: "scenario",
    resourceId: scenarioId,
    clientId,
    firmId,
    actorId: userId,
    metadata: {
      scenarioName,
      toggleState,
      snapshotId: snapshot.id,
      deletedScenarioCount,
      notesKept: notes.kept,
      notesDropped: notes.dropped,
      counts,
    },
  });

  return { snapshotId: snapshot.id, deletedScenarioCount, counts, notes };
}
