// src/lib/scenario/changes-writer.ts
//
// Server-side diff writer for scenario_changes rows. Takes a desired-state
// edit (e.g., "set income.annualAmount to 275000 in scenario X") and emits the
// right scenario_changes row(s): upsert with field-level diff for `edit`,
// delete-when-revert-to-base, and add/remove handling that collapses inverse
// pairs (remove-of-an-add becomes a no-op delete, not a remove row) — except
// for `gift`, which has no `edit` op and so always keeps the remove marker.
// See `applyEntityRemove`. `ltc_event` has no `edit` op either (it is saved
// whole, as an `add`), but it is scenario-only, so its remove collapses like
// any other add.
//
// The Postgres trigger from Plan 2 Task 1 forbids any non-base writes to
// scenario-bearing tables, so this writer is the *only* sanctioned path for
// non-base mutations.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { scenarioChanges, scenarios } from "@/db/schema";
import {
  SINGLETON_KIND_TO_FIELD,
  TARGET_KIND_TO_FIELD,
} from "@/engine/scenario/applyChanges";
import type { OpType, TargetKind } from "@/engine/scenario/types";
import type { PlanSettings } from "@/engine/types";
import { ForbiddenError } from "@/lib/authz";
import { stableStringify } from "@/lib/compute-cache/hash";
import { findClientInFirm } from "@/lib/db-scoping";
import { ltcEventSchema } from "@/lib/schemas/ltc-event";
import { loadEffectiveTree } from "./loader";
import { businessCashRidersOf } from "./business-cash-rider";

/**
 * A Drizzle transaction handle (the value passed to a `db.transaction` callback).
 * Callers that already hold an open transaction can pass it as `args.tx` so the
 * writer's statements enroll in THAT transaction instead of opening their own —
 * letting a multi-change batch commit or roll back as one unit. Omitting it
 * preserves the original behavior (each writer manages its own transaction).
 */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
 * Look up the base-tree entity by (targetKind, targetId). For singleton kinds
 * (`client`, `plan_settings`) returns the singleton object directly — there is
 * only one per tree, so `targetId` is not used to locate it. For list kinds
 * returns the matching array element, or undefined if the array is missing or
 * the id isn't found. Throws for nested-only targetKinds — those aren't
 * writable through this helper in v1.
 */
async function lookupBaseEntity(
  clientId: string,
  firmId: string,
  targetKind: TargetKind,
  targetId: string,
): Promise<BaseEntity | undefined> {
  const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});

  const singletonField = SINGLETON_KIND_TO_FIELD[targetKind];
  if (singletonField != null) {
    return effectiveTree[singletonField] as unknown as BaseEntity;
  }

  const field = TARGET_KIND_TO_FIELD[targetKind];
  if (field == null) {
    throw new Error(
      `changes-writer: unsupported targetKind=${targetKind} ` +
        `(nested entities are not writable via this helper)`,
    );
  }

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
export function buildFieldDiff(
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
 * The `to` side of a stored edit payload — what earlier saves set. Used to
 * merge a prior edit's fields into a new one's `desiredFields` before
 * diffing against base, so a second partial save doesn't wipe the first's.
 * An entry with no `to` key (JSON drops an `undefined` `to`, leaving
 * `{from: X}`) carries no prior value and is skipped; `to: null` and `to: 0`
 * are real values and are kept.
 */
export function priorToValues(payload: unknown): Record<string, unknown> {
  if (typeof payload !== "object" || payload === null) return {};
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>)
      .filter(([, v]) => typeof v === "object" && v !== null && "to" in v)
      .map(([k, v]) => [k, (v as { to: unknown }).to]),
  );
}

/**
 * Robust equality for diff: normalizes numeric strings (Drizzle decimals come
 * back as strings like `"250000.00"`) to numbers before comparing. Nested
 * structures compare canonically (`stableStringify`: key order ignored, array
 * order kept, nested numbers to 6 decimals) — an editor and the loader build
 * the same object in different key orders (the life-policy dialog's
 * `lifeInsurance` vs `loadPolicies`), and a key-order-sensitive compare stored
 * an edit on every unchanged save.
 */
function valuesEqual(a: unknown, b: unknown): boolean {
  // null and undefined both mean "no value" to a diff — a base `null` and a
  // merged-away `undefined` (an absent field in `priorToValues`/`desiredFields`)
  // must compare equal, or an unset field would diff in as a change instead of
  // just not appearing in the merge.
  if (a == null && b == null) return true;
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
  // Structural fallback for objects/arrays. Only objects go through
  // `stableStringify`: it also rounds numbers to 6 decimals, which a top-level
  // rate must not inherit.
  try {
    return typeof a === "object" && typeof b === "object"
      ? stableStringify(a) === stableStringify(b)
      : JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * The `toggleGroupId` column for an upsert's conflict (re-save) branch:
 * undefined = the caller didn't say, so the existing row keeps its group;
 * null = unlink; a string = link there. A brand-new row's INSERT defaults an
 * unsaid group to null. Every Details editor re-saves without a group id
 * (`useScenarioWriter` never sends one), so overwriting on omission silently
 * pulled grouped changes out of their group — always on (Ruling F-I1).
 */
function keepGroupUnlessSaid(
  toggleGroupId: string | null | undefined,
): { toggleGroupId?: string | null } {
  return toggleGroupId === undefined ? {} : { toggleGroupId };
}

/**
 * Overlayable singleton keys the base singleton does not carry, so `k in
 * baseEntity` can't vouch for them. For `plan_settings` these are the optional
 * Stress-test keys on the engine's `PlanSettings` (`src/engine/types.ts`) —
 * `loadClientData` never sets them, and the Solver writes them into a
 * scenario's plan_settings edit. Without this list, the next save of any other
 * plan_settings field (e.g. `planEndYear`) would drop them from the merge.
 */
const OPTIONAL_SINGLETON_KEYS: Partial<Record<TargetKind, readonly string[]>> = {
  plan_settings: [
    "marketShock",
    "ssBenefitHaircut",
    "disabilityEvent",
    "taxRateStress",
    "livingExpenseInflationOverride",
  ] satisfies readonly (keyof PlanSettings)[],
};

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
  /** Run on this open transaction instead of opening a new one (batch atomicity). */
  tx?: Tx;
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
  // An LTC event is saved whole: an edit would merge an unvalidated partial
  // payload into it. A change to the event is re-saved whole as an `add`,
  // which `applyEntityAdd` validates and upserts.
  if (args.targetKind === "ltc_event") {
    throw new Error(
      "changes-writer: targetKind=ltc_event has no edit (re-save the whole event as an add)",
    );
  }
  const { scenarioId, firmId, targetKind, targetId, desiredFields } = args;
  const toggleGroupId = args.toggleGroupId ?? null;

  const { clientId } = await assertScenarioInFirm(scenarioId, firmId);
  const baseEntity = await lookupBaseEntity(clientId, firmId, targetKind, targetId);

  // Singleton edits: the shared client form posts contact-info fields
  // (email/address/spouse*) that aren't on the engine's `ClientInfo` singleton
  // and so aren't scenario-overlayable. Drop any field that is neither on the
  // base singleton nor in `OPTIONAL_SINGLETON_KEYS` — otherwise they diff as
  // `from: undefined`, bloat the change payload, and block the idempotent
  // revert below. Applied to the MERGED map in `runEdit` (prior row + this
  // save), so such a key stored on an older edit row is dropped too rather
  // than persisting forever.
  const optionalKeys: readonly string[] = OPTIONAL_SINGLETON_KEYS[targetKind] ?? [];
  const keepEditable = (fields: Record<string, unknown>) =>
    SINGLETON_KIND_TO_FIELD[targetKind] != null && baseEntity != null
      ? Object.fromEntries(
          Object.entries(fields).filter(
            ([k]) => k in baseEntity || optionalKeys.includes(k),
          ),
        )
      : fields;

  // The load + delete/upsert sequence below reads the base tree and then
  // either deletes a stale edit row (if desired matches base) or upserts a
  // merged diff. Wrapping in a transaction keeps the read-modify-write atomic
  // against concurrent writers on the same target. When the caller passes an
  // open transaction, enroll in it instead of opening a nested one.
  const runEdit = async (tx: Tx) => {
    // Two locks guard the merge, each against a different race:
    //  - This transaction-scoped advisory lock (held until commit/rollback)
    //    serializes `applyEntityEdit` saves of one target. The first save of
    //    a target has no edit row for `FOR UPDATE` to lock, so without it two
    //    racing partial saves could each read "no prior edit" and the second
    //    upsert would drop the first's fields.
    //  - `FOR UPDATE` on the existing edit row (below) serializes against
    //    writers that don't take the advisory lock — `revertChange` and
    //    `applyEntityRemove` delete that row. Without the row lock, a delete
    //    committed between our read and our upsert would be silently undone
    //    by the upsert re-inserting the merged prior fields.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${scenarioId}:${targetKind}:${targetId}`}))`,
    );

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

    // Merge this save's fields over whatever an earlier partial save already
    // set, so two saves of different fields (e.g. two tabs of a dialog)
    // compose into one row instead of the second wiping the first.
    const [existingEdit] = await tx
      .select()
      .from(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetKind, targetKind),
          eq(scenarioChanges.targetId, targetId),
          eq(scenarioChanges.opType, "edit"),
        ),
      )
      .for("update");
    const diff = buildFieldDiff(
      keepEditable({ ...priorToValues(existingEdit?.payload), ...desiredFields }),
      baseEntity,
    );

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
          ...keepGroupUnlessSaid(args.toggleGroupId),
          updatedAt: new Date(),
        },
      });
  };

  if (args.tx) await runEdit(args.tx);
  else await db.transaction(runEdit);
}

export interface ApplyEntityAddArgs {
  scenarioId: string;
  firmId: string;
  targetKind: TargetKind;
  entity: BaseEntity;
  toggleGroupId?: string | null;
  /** Run on this open transaction instead of opening a new one (batch atomicity). */
  tx?: Tx;
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
  const { scenarioId, firmId, targetKind } = args;
  let { entity } = args;
  // An LTC event has no Details form to shape it, so it is validated whole
  // here, where the changes route, Forge and the Solver's "update this
  // scenario" land. (The Solver's "save as new scenario" inserts its rows
  // directly; its adds are validated by the mutation schema instead.) The
  // parsed copy is stored, which drops any unknown key.
  if (targetKind === "ltc_event") {
    const ltc = ltcEventSchema.safeParse(entity);
    if (!ltc.success) {
      throw new Error(`changes-writer: invalid ltc_event entity: ${ltc.error.message}`);
    }
    entity = ltc.data;
  }
  const toggleGroupId = args.toggleGroupId ?? null;

  await assertScenarioInFirm(scenarioId, firmId);

  // Sanity check — singletons and nested entities aren't writable here.
  if (TARGET_KIND_TO_FIELD[targetKind] == null) {
    throw new Error(
      `changes-writer: unsupported targetKind=${targetKind} for add ` +
        `(singletons and nested entities are not writable via this helper)`,
    );
  }

  await (args.tx ?? db)
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
        ...keepGroupUnlessSaid(args.toggleGroupId),
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
  /** Run on this open transaction instead of opening a new one (batch atomicity). */
  tx?: Tx;
}

/**
 * If the entity was added in this scenario (an `add` row exists), deletes the
 * `add` row (and any `edit` row piled on top) — collapsing the inverse pair.
 * Otherwise upserts a `remove` row.
 *
 * GIFTS ARE THE EXCEPTION, and they always get the remove marker — see the
 * comment on `hasAdd` below.
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
  // applyChanges). When the caller passes an open transaction, enroll in it
  // instead of opening a nested one.
  const runRemove = async (tx: Tx) => {
    // Look for an existing `add` row on this target. For every kind EXCEPT
    // `gift` an `add` means the entity is scenario-only, so deleting it (plus
    // any piled-on edit) restores the base view with no remove marker left
    // behind. A gift's `add` does NOT mean that — see the note below the
    // query — so a gift always gets the remove marker.
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

    // An `add` row means "scenario-only" for every kind EXCEPT `gift`. Gifts
    // have no `edit` op: the overlay strips every targeted id and
    // re-materialises only `add` payloads (apply-gift-overlays.ts), so a save
    // — of a new gift OR of a base-plan one — is always an `add` carrying the
    // full draft (lib/gifts/gift-write.ts). Editing a base gift in a scenario
    // therefore leaves an `add` row on a base gift's id, and collapsing that
    // add on delete would resurrect the base row un-edited while the UI showed
    // the gift gone. Every other kind but `ltc_event` reaches `applyEntityEdit`,
    // which writes an `edit` row for a base entity and only merges into an
    // `add` when one already exists; an `ltc_event` exists only as an `add`
    // (scenario-only, no base row). So for all of them `hasAdd` really does
    // mean scenario-only.
    const hasAdd = existing.some((r) => r.opType === "add");
    if (hasAdd && targetKind !== "gift") {
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
      if (targetKind === "account") await dropAddedAccountChildren(tx, scenarioId, targetId);
      return;
    }

    // Base entity — or ANY gift. Write a remove row, and clear the rows the
    // remove supersedes: any piled-on `edit` (editing a removed row would be
    // meaningless) and, for a gift, the `add` that the overlay would otherwise
    // re-materialise straight back on top of the strip. Deleting the add and
    // writing the marker is the ONE combination that leaves a gift gone in both
    // cases — a gift born in this scenario (nothing to strip, the marker is a
    // harmless no-op) and a base gift edited here first. Same rule the solver
    // already encodes: mutations-to-scenario-changes.ts:596-606, "Remove always
    // emits, even for a base asset/series id absent from source.gifts."
    await tx
      .delete(scenarioChanges)
      .where(
        and(
          eq(scenarioChanges.scenarioId, scenarioId),
          eq(scenarioChanges.targetKind, targetKind),
          eq(scenarioChanges.targetId, targetId),
          targetKind === "gift"
            ? inArray(scenarioChanges.opType, ["edit", "add"])
            : eq(scenarioChanges.opType, "edit"),
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
          ...keepGroupUnlessSaid(args.toggleGroupId),
          updatedAt: new Date(),
        },
      });
  };

  if (args.tx) await runRemove(args.tx);
  else await db.transaction(runRemove);
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
    if (targetKind === "account" && opType === "add") {
      await dropAddedAccountChildren(tx, scenarioId, targetId);
    }
  });
}

/**
 * A scenario-added account's `add` row is going away. Its children are separate
 * `add` rows whose `parentAccountId` is its synthetic id. A business's
 * "<name> — Cash" account is part of the business and goes with it. Any other
 * child (a line of credit) is released to the top level, as base's
 * `ON DELETE SET NULL` and `resolveCascades`' parent_account_cleared do — left
 * dangling, every later promote FK-fails inserting the child.
 */
export async function dropAddedAccountChildren(
  tx: Tx,
  scenarioId: string,
  accountId: string,
): Promise<void> {
  await tx.delete(scenarioChanges).where(businessCashRidersOf(scenarioId, accountId));
  await tx
    .update(scenarioChanges)
    .set({
      payload: sql`jsonb_set(${scenarioChanges.payload}, '{parentAccountId}', 'null'::jsonb)`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(scenarioChanges.scenarioId, scenarioId),
        eq(scenarioChanges.opType, "add"),
        sql`${scenarioChanges.payload}->>'parentAccountId' = ${accountId}`,
      ),
    );
}
