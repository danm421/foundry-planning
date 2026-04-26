// src/lib/scenario/changes-writer.ts
//
// Server-side diff writer for scenario_changes rows. Takes a desired-state
// edit (e.g., "set income.annualAmount to 275000 in scenario X") and emits the
// right scenario_changes row(s): upsert with field-level diff for `edit`,
// delete-when-revert-to-base, and add/remove handling that collapses inverse
// pairs (remove-of-an-add becomes a no-op delete, not a remove row).
//
// The Postgres trigger from Plan 2 Task 1 forbids any non-base writes to
// scenario-bearing tables, so this writer is the *only* sanctioned path for
// non-base mutations.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarioChanges, scenarios } from "@/db/schema";
import { TARGET_KIND_TO_FIELD } from "@/engine/scenario/applyChanges";
import type { OpType, TargetKind } from "@/engine/scenario/types";
import { ForbiddenError } from "@/lib/authz";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "./loader";

interface BaseEntity {
  id: string;
  [k: string]: unknown;
}

/**
 * Authorization gate for every public writer entrypoint. Looks up the scenario
 * by id, then verifies its client belongs to `firmId`. Throws `ForbiddenError`
 * if either lookup fails — never leak the existence of cross-firm scenarios.
 *
 * Returns `clientId` so callers can reuse it without a second roundtrip.
 *
 * Replaces the prior `getScenarioClientId` helper, which trusted the caller's
 * firmId silently and let any authenticated user write changes against any
 * scenario id they could guess. AGENTS.md mandates org-scoping on every
 * mutation — this writer is the only sanctioned path for scenario_changes
 * writes (per the §3.2 base-only trigger from Task 1), so the check has to
 * live here.
 */
async function assertScenarioInFirm(
  scenarioId: string,
  firmId: string,
): Promise<{ clientId: string }> {
  const [row] = await db
    .select({ clientId: scenarios.clientId })
    .from(scenarios)
    .where(eq(scenarios.id, scenarioId));
  if (!row) {
    throw new ForbiddenError(`Scenario ${scenarioId} not accessible`);
  }
  const client = await findClientInFirm(row.clientId, firmId);
  if (!client) {
    throw new ForbiddenError(`Scenario ${scenarioId} not accessible`);
  }
  return { clientId: row.clientId };
}

/**
 * Look up the base-tree entity by (targetKind, targetId). Returns undefined if
 * the array is missing or the id isn't found. Throws for unsupported
 * targetKinds — singletons and nested-only targets aren't writable through
 * this helper in v1.
 */
async function lookupBaseEntity(
  clientId: string,
  firmId: string,
  targetKind: TargetKind,
  targetId: string,
): Promise<BaseEntity | undefined> {
  const field = TARGET_KIND_TO_FIELD[targetKind];
  if (field == null) {
    throw new Error(
      `changes-writer: unsupported targetKind=${targetKind} ` +
        `(singletons and nested entities are not writable via this helper)`,
    );
  }

  const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});
  const arr = effectiveTree[field] as unknown as BaseEntity[] | undefined;
  if (arr == null) return undefined;
  return arr.find((e) => e.id === targetId);
}

/**
 * Build a field-level diff map, comparing desiredFields against baseEntity.
 * Skips fields whose desired value already matches the base. Numeric strings
 * (Drizzle decimals) are normalized to numbers before comparison so the diff
 * doesn't mis-fire on `"250000.00"` vs `250000`.
 */
function buildFieldDiff(
  desiredFields: Record<string, unknown>,
  baseEntity: BaseEntity | undefined,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, desired] of Object.entries(desiredFields)) {
    const fromValue = baseEntity ? baseEntity[k] : undefined;
    if (!valuesEqual(fromValue, desired)) {
      diff[k] = { from: fromValue, to: desired };
    }
  }
  return diff;
}

/**
 * Robust equality for diff: normalizes numeric strings (Drizzle decimals come
 * back as strings like `"250000.00"`) to numbers before comparing. Falls back
 * to JSON.stringify for nested structures.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // Numeric normalization: "250000.00" === 250000
  const aNum = typeof a === "string" ? Number(a) : a;
  const bNum = typeof b === "string" ? Number(b) : b;
  if (
    typeof aNum === "number" &&
    typeof bNum === "number" &&
    !Number.isNaN(aNum) &&
    !Number.isNaN(bNum) &&
    aNum === bNum
  ) {
    return true;
  }
  // Structural fallback for objects/arrays.
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ApplyEntityEditArgs {
  scenarioId: string;
  firmId: string;
  targetKind: TargetKind;
  targetId: string;
  desiredFields: Record<string, unknown>;
  toggleGroupId?: string | null;
}

/**
 * Upsert an `edit` change with field-level diff vs base. If every desiredField
 * matches base, deletes any existing edit row for the target (idempotent
 * revert).
 *
 * Edit-of-add collapse: when the target was added in this scenario (an `add`
 * row exists), folds the new field values into the add row's payload instead
 * of inserting a parallel `edit` row — symmetric to the add-collapse in
 * `applyEntityRemove`. Without this, editing a scenario-added entity left two
 * rows in `scenario_changes` (different opTypes, both permitted by the
 * `(scenarioId, targetKind, targetId, opType)` unique index), which the
 * Changes panel rendered as two leaf rows for a single in-scenario entity.
 */
export async function applyEntityEdit(args: ApplyEntityEditArgs): Promise<void> {
  const { scenarioId, firmId, targetKind, targetId, desiredFields } = args;
  const toggleGroupId = args.toggleGroupId ?? null;

  const { clientId } = await assertScenarioInFirm(scenarioId, firmId);
  const baseEntity = await lookupBaseEntity(clientId, firmId, targetKind, targetId);
  const diff = buildFieldDiff(desiredFields, baseEntity);

  // The load + delete/upsert sequence below reads the base tree and then
  // either deletes a stale edit row (if desired matches base) or upserts a
  // new diff. Wrapping in a transaction keeps the read-modify-write atomic
  // against concurrent writers on the same target.
  await db.transaction(async (tx) => {
    const [existingAdd] = await tx
      .select()
      .from(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetKind, targetKind),
          eq(scenarioChanges.targetId, targetId),
          eq(scenarioChanges.opType, "add"),
        ),
      );
    if (existingAdd) {
      // Merge desiredFields into the add row's payload. Preserve the add's
      // existing toggleGroupId unless the caller explicitly passed one
      // (undefined = "didn't say"; null = "unlink"; string = "link here").
      const mergedPayload = {
        ...(existingAdd.payload as Record<string, unknown>),
        ...desiredFields,
      };
      const nextToggleGroupId =
        args.toggleGroupId === undefined ? existingAdd.toggleGroupId : toggleGroupId;
      await tx
        .update(scenarioChanges)
        .set({
          payload: mergedPayload,
          toggleGroupId: nextToggleGroupId,
          updatedAt: new Date(),
        })
        .where(eq(scenarioChanges.id, existingAdd.id));
      // Drop any orphan edit row that legacy buggy writes may have left
      // alongside the add (pre-fix data).
      await tx
        .delete(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetKind, targetKind),
            eq(scenarioChanges.targetId, targetId),
            eq(scenarioChanges.opType, "edit"),
          ),
        );
      return;
    }

    // Idempotent revert: if every desired value matches base, drop any
    // existing edit row for this target.
    if (Object.keys(diff).length === 0) {
      await tx
        .delete(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetKind, targetKind),
            eq(scenarioChanges.targetId, targetId),
            eq(scenarioChanges.opType, "edit"),
          ),
        );
      return;
    }

    // Upsert via the (scenarioId, targetKind, targetId, opType) unique index.
    await tx
      .insert(scenarioChanges)
      .values({
        scenarioId,
        opType: "edit",
        targetKind,
        targetId,
        payload: diff,
        toggleGroupId,
      })
      .onConflictDoUpdate({
        target: [
          scenarioChanges.scenarioId,
          scenarioChanges.targetKind,
          scenarioChanges.targetId,
          scenarioChanges.opType,
        ],
        set: {
          payload: diff,
          toggleGroupId,
          updatedAt: new Date(),
        },
      });
  });
}

export interface ApplyEntityAddArgs {
  scenarioId: string;
  firmId: string;
  targetKind: TargetKind;
  entity: BaseEntity;
  toggleGroupId?: string | null;
}

/**
 * Insert an `add` row carrying the full entity payload. The targetId on the
 * row equals `entity.id` (the caller chooses it; v1 expects a fresh uuid).
 * Idempotent on the unique index — re-running with the same id updates the
 * payload.
 */
export async function applyEntityAdd(
  args: ApplyEntityAddArgs,
): Promise<{ targetId: string }> {
  const { scenarioId, firmId, targetKind, entity } = args;
  const toggleGroupId = args.toggleGroupId ?? null;

  await assertScenarioInFirm(scenarioId, firmId);

  // Sanity check — singletons and nested entities aren't writable here.
  if (TARGET_KIND_TO_FIELD[targetKind] == null) {
    throw new Error(
      `changes-writer: unsupported targetKind=${targetKind} for add ` +
        `(singletons and nested entities are not writable via this helper)`,
    );
  }

  await db
    .insert(scenarioChanges)
    .values({
      scenarioId,
      opType: "add",
      targetKind,
      targetId: entity.id,
      payload: entity,
      toggleGroupId,
    })
    .onConflictDoUpdate({
      target: [
        scenarioChanges.scenarioId,
        scenarioChanges.targetKind,
        scenarioChanges.targetId,
        scenarioChanges.opType,
      ],
      set: {
        payload: entity,
        toggleGroupId,
        updatedAt: new Date(),
      },
    });

  return { targetId: entity.id };
}

export interface ApplyEntityRemoveArgs {
  scenarioId: string;
  firmId: string;
  targetKind: TargetKind;
  targetId: string;
  toggleGroupId?: string | null;
}

/**
 * If the entity was added in this scenario (an `add` row exists), deletes the
 * `add` row (and any `edit` row piled on top) — collapsing the inverse pair.
 * Otherwise upserts a `remove` row.
 */
export async function applyEntityRemove(args: ApplyEntityRemoveArgs): Promise<void> {
  const { scenarioId, firmId, targetKind, targetId } = args;
  const toggleGroupId = args.toggleGroupId ?? null;

  await assertScenarioInFirm(scenarioId, firmId);

  // Sanity check.
  if (TARGET_KIND_TO_FIELD[targetKind] == null) {
    throw new Error(
      `changes-writer: unsupported targetKind=${targetKind} for remove`,
    );
  }

  // Three-statement sequence (select existing → delete add+edit OR
  // delete edit + upsert remove). Wrapping in a transaction prevents a
  // concurrent writer from inserting an `add` row between our select and
  // our remove-upsert (which would leave both rows present and confuse
  // applyChanges).
  await db.transaction(async (tx) => {
    // Check for an existing `add` row — if present, the entity is
    // scenario-only; deleting the add row (plus any piled-on edit) restores
    // the base view without leaving a remove marker.
    const existing = await tx
      .select()
      .from(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetKind, targetKind),
          eq(scenarioChanges.targetId, targetId),
        ),
      );

    const hasAdd = existing.some((r) => r.opType === "add");
    if (hasAdd) {
      // Drop both add and any edit row for this target.
      await tx
        .delete(scenarioChanges)
        .where(
          and(
            eq(scenarioChanges.scenarioId, scenarioId),
            eq(scenarioChanges.targetKind, targetKind),
            eq(scenarioChanges.targetId, targetId),
          ),
        );
      return;
    }

    // Base entity: write a remove row (and clear any piled-on edit, since
    // editing a removed row would be meaningless).
    await tx
      .delete(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetKind, targetKind),
          eq(scenarioChanges.targetId, targetId),
          eq(scenarioChanges.opType, "edit"),
        ),
      );

    await tx
      .insert(scenarioChanges)
      .values({
        scenarioId,
        opType: "remove",
        targetKind,
        targetId,
        payload: null,
        toggleGroupId,
      })
      .onConflictDoUpdate({
        target: [
          scenarioChanges.scenarioId,
          scenarioChanges.targetKind,
          scenarioChanges.targetId,
          scenarioChanges.opType,
        ],
        set: {
          toggleGroupId,
          updatedAt: new Date(),
        },
      });
  });
}

export interface RevertChangeArgs {
  scenarioId: string;
  firmId: string;
  targetKind: TargetKind;
  targetId: string;
  opType: OpType;
}

/** Delete the matching change row. No-op if nothing matches. */
export async function revertChange(args: RevertChangeArgs): Promise<void> {
  const { scenarioId, firmId, targetKind, targetId, opType } = args;
  // Auth check + delete are wrapped in a tx so the auth-then-mutate pair is
  // atomic — no window where the scenario could be reassigned to another
  // firm between the check and the delete.
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ clientId: scenarios.clientId })
      .from(scenarios)
      .where(eq(scenarios.id, scenarioId));
    if (!row) {
      throw new ForbiddenError(`Scenario ${scenarioId} not accessible`);
    }
    const client = await findClientInFirm(row.clientId, firmId);
    if (!client) {
      throw new ForbiddenError(`Scenario ${scenarioId} not accessible`);
    }

    await tx
      .delete(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetKind, targetKind),
          eq(scenarioChanges.targetId, targetId),
          eq(scenarioChanges.opType, opType),
        ),
      );
  });
}
