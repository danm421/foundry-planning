// src/lib/solver/save-scenario.ts
//
// Saving solver mutations as scenario data. `saveSolverScenario` creates a NEW
// non-base scenario — the scenarios row, its scenario_changes rows, and the
// scenario-PARTITIONED tables (`gift_series`, `entity_flow_overrides`,
// `notes_receivable` and its two child tables), in one transaction. The
// Solver's "Save as scenario" (POST /api/clients/[id]/solver/save-scenario)
// and the Claude connector's save_what_if_as_scenario both call it, so a
// scenario saved from Claude is indistinguishable from one saved on the Solver
// screen. The route's PUT (fold into an existing scenario) reuses the helpers.
// Held Details-editor changes (`held-change`) are written through the scenario
// writer by both, as the editor's own save would have written them.
//
// Callers own authorization (edit access to the client, in this firm) and the
// audit row; nothing here reads a session.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  entityFlowOverrides,
  noteExtraPayments,
  noteReceivableOwners,
  notesReceivable,
  scenarios,
  scenarioChanges,
  scenarioToggleGroups,
} from "@/db/schema";
import {
  revocableTrustFundingGroups,
  resolveFundingGroupRows,
  type FundingGroupRow,
} from "@/lib/solver/revocable-trust-funding-group";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import { heldScenarioChanges } from "@/lib/solver/held-changes";
import type { SolverMutation, SolverScenarioChangeDraft } from "@/lib/solver/types";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { applyEntityAdd, applyEntityEdit, applyEntityRemove } from "@/lib/scenario/changes-writer";
import { priorToValues, targetKeyOf } from "@/lib/scenario/field-diff";
import {
  cloneEntityFlowOverridesIntoScenario,
  cloneGiftSeriesIntoScenario,
  findBaseScenarioId,
} from "@/lib/scenario/create-with-clone";
import type { ClientData } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import type { OpType, TargetKind } from "@/engine/scenario/types";

/** Loosely-typed tx handle — same derivation as create-with-clone's, because
 *  Drizzle does not export its tx callback param as a named type here. */
export type SaveTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type NoteMutation = Extract<SolverMutation, { kind: "note-receivable-upsert" }>;

/** Which `notes_receivable` row a note mutation writes, and whether that row
 *  already exists. `rowId` is usually the mutation's own id; it differs only on
 *  the POST fork described in `planNoteWrites`. */
interface NoteWrite {
  rowId: string;
  exists: boolean;
  /** The toggle group the existing row is already gated by — non-null exactly
   *  when `exists` is true, because `planNoteWrites` only marks a row existing
   *  when a group THIS scenario owns gates it. A sale's re-save reuses it so
   *  the owner flip and the note stay under one group instead of drifting
   *  apart on every update. */
  toggleGroupId: string | null;
}

const isNoteMutation = (m: SolverMutation): m is NoteMutation =>
  m.kind === "note-receivable-upsert";

/**
 * Write one change through the scenario writer, on `tx`: a held editor change,
 * as the editor's own save would have written it, or a control aimed at an
 * item one touches, which the writer then merges into that item's row. With no
 * `toggleGroupId` an existing row keeps its group, so an edit folded into an
 * `add` keeps the add's.
 */
export async function writeThroughWriter(
  tx: SaveTx,
  scope: { scenarioId: string; firmId: string },
  change: { opType: OpType; targetKind: TargetKind; targetId: string; payload: unknown },
  toggleGroupId?: string,
): Promise<void> {
  const args = { ...scope, targetKind: change.targetKind, tx, ...(toggleGroupId ? { toggleGroupId } : {}) };
  if (change.opType === "add") {
    await applyEntityAdd({ ...args, entity: change.payload as { id: string } & Record<string, unknown> });
  } else if (change.opType === "edit") {
    await applyEntityEdit({ ...args, targetId: change.targetId, desiredFields: priorToValues(change.payload) });
  } else {
    await applyEntityRemove({ ...args, targetId: change.targetId });
  }
}

/**
 * The note mutations of a save, collapsed to the LAST one per note id.
 *
 * The solver's mutation list is a keyed map flattened to an array, not an
 * ordered append log — `apply-mutations.ts` filters `notesReceivable` by id
 * before pushing, so a later mutation for the same note REPLACES an earlier
 * one. Writing the raw list instead would insert the same primary key twice on
 * an upsert+upsert pair (500ing the whole save) and would persist a note the
 * advisor removed on an upsert+delete pair.
 *
 * `entity-flow-override-upsert` needs no equivalent: its writer collects a Set
 * of entity ids and sources every row from the working tree, which is already
 * the collapsed result.
 */
export function lastNoteMutationPerId(
  mutations: readonly SolverMutation[],
): NoteMutation[] {
  const byId = new Map<string, NoteMutation>();
  for (const m of mutations) {
    if (isNoteMutation(m)) byId.set(m.id, m);
  }
  return [...byId.values()];
}

/**
 * Write the working tree's complete flow grid for every entity an
 * `entity-flow-override-upsert` touched, replacing whatever the target scenario
 * held for that entity.
 *
 * Per-ENTITY whole-grid replace, not a per-(entity, year) upsert, because
 * per-entity is the granularity the loader inherits at: `loadEffectiveTree`
 * hands an entity with ZERO scenario-scoped rows the BASE entity's whole grid,
 * deliberately. Writing only the edited year would leave every other year
 * inherited from base and silently diverging from the numbers the advisor saw
 * in the solver. The canonical writer for this table — PUT
 * /api/clients/[id]/entities/[entityId]/flow-overrides — replaces the same way.
 *
 * Deliberately writes no all-null "tombstone" row for a year the advisor
 * cleared: inheritance is suppressed per entity, so one tombstone would also
 * delete the inherited neighbouring years. The residual is that clearing an
 * entity's LAST override year leaves zero rows and the loader falls back to
 * base — exactly what the grid editor does today.
 */
export async function persistEntityFlowOverrides(
  tx: SaveTx,
  scenarioId: string,
  mutations: readonly SolverMutation[],
  workingTree: ClientData,
): Promise<void> {
  const entityIds = new Set(
    mutations.flatMap((m) =>
      m.kind === "entity-flow-override-upsert" ? [m.entityId] : [],
    ),
  );
  for (const entityId of entityIds) {
    await tx
      .delete(entityFlowOverrides)
      .where(
        and(
          eq(entityFlowOverrides.scenarioId, scenarioId),
          eq(entityFlowOverrides.entityId, entityId),
        ),
      );
    const rows = (workingTree.entityFlowOverrides ?? []).filter(
      (o) => o.entityId === entityId,
    );
    if (rows.length === 0) continue;
    await tx.insert(entityFlowOverrides).values(
      rows.map((o) => ({
        entityId,
        scenarioId,
        year: o.year,
        // decimal columns — Drizzle wants strings. A number written here comes
        // back out as one the engine concatenates instead of adding.
        incomeAmount: o.incomeAmount != null ? String(o.incomeAmount) : null,
        expenseAmount: o.expenseAmount != null ? String(o.expenseAmount) : null,
        distributionPercent:
          o.distributionPercent != null ? String(o.distributionPercent) : null,
      })),
    );
  }
}

/** The `note_receivable_owners` column triple for one engine owner. The table's
 *  CHECK requires exactly one of the three, and `gifted_away` has no column at
 *  all — throwing beats letting Postgres reject the row with a constraint name. */
function noteOwnerColumns(o: AccountOwner) {
  switch (o.kind) {
    case "family_member":
      return { familyMemberId: o.familyMemberId, entityId: null, externalBeneficiaryId: null };
    case "entity":
      return { familyMemberId: null, entityId: o.entityId, externalBeneficiaryId: null };
    case "external_beneficiary":
      return { familyMemberId: null, entityId: null, externalBeneficiaryId: o.externalBeneficiaryId };
    default:
      throw new Error(`note owner kind "${o.kind}" has no note_receivable_owners column`);
  }
}

/**
 * Persist the solver's note-receivable mutations across all three tables
 * (`notes_receivable` + `note_receivable_owners` + `note_extra_payments`).
 *
 * Where the row goes: the client's BASE partition, gated by a toggle group the
 * TARGET scenario owns. That is not the obvious choice, so: `notes_receivable`
 * has a scenario_id, but no loader ever reads it for a non-base scenario —
 * `load-client-data.ts` reads notes for the base case only and
 * `loadEffectiveTree` merely toggle-filters that set. A row written under the
 * saved scenario's own id would therefore be read by nobody. The base row +
 * scenario-owned toggle group is the shape the sale-to-trust route and
 * `resolveToggleGatedNotesOnBase` (promote) both already assume.
 *
 * `writes` says which row id each mutation targets and whether it already
 * exists; `planNoteWrites` builds it before the transaction opens and rejects
 * the cases a scenario cannot express.
 *
 * `startYearRef` is never written: it is a Postgres enum column and the wire
 * schema does not validate the field, so a `.passthrough()` producer must not
 * be able to reach it. An existing row keeps whatever it already had.
 */
export async function persistNoteReceivables(
  tx: SaveTx,
  args: {
    clientId: string;
    scenarioId: string;
    baseScenarioId: string;
    writes: ReadonlyMap<string, NoteWrite>;
    /** Group id per note id for notes already paired with a sale's owner flip
     *  by `resolveToggleGroups` — that group's row is inserted there, before
     *  the change rows are tagged, so this function must not mint a second
     *  one. A note absent from the map still gets its own, as every note did
     *  before sales were paired. */
    groupIdByNote: ReadonlyMap<string, string>;
    groupOrderStart: number;
  },
  mutations: readonly NoteMutation[],
): Promise<void> {
  let orderIndex = args.groupOrderStart;
  for (const m of mutations) {
    // planNoteWrites seeds an entry for every id it was handed.
    const { rowId, exists } = args.writes.get(m.id)!;
    if (m.value === null) {
      // Nothing to delete when the row does not exist here — on the POST fork
      // that means the original belongs to another scenario and is already
      // invisible in this one.
      if (exists) {
        await tx.delete(notesReceivable).where(eq(notesReceivable.id, rowId));
      }
      continue;
    }
    const v = m.value;
    const columns = {
      name: v.name,
      faceValue: String(v.faceValue),
      basis: String(v.basis),
      asOfBalance: v.asOfBalance != null ? String(v.asOfBalance) : null,
      balanceAsOfMonth: v.balanceAsOfMonth ?? null,
      balanceAsOfYear: v.balanceAsOfYear ?? null,
      interestRate: String(v.interestRate),
      paymentType: v.paymentType,
      monthlyPayment: v.monthlyPayment != null ? String(v.monthlyPayment) : null,
      startYear: v.startYear,
      startMonth: v.startMonth,
      termMonths: v.termMonths,
      linkedTrustEntityId: v.linkedTrustEntityId ?? null,
    };

    if (exists) {
      await tx
        .update(notesReceivable)
        .set({ ...columns, updatedAt: new Date() })
        .where(eq(notesReceivable.id, rowId));
      // Children are replaced wholesale, matching the canonical note PATCH.
      await tx
        .delete(noteReceivableOwners)
        .where(eq(noteReceivableOwners.noteReceivableId, rowId));
      await tx
        .delete(noteExtraPayments)
        .where(eq(noteExtraPayments.noteReceivableId, rowId));
    } else {
      const paired = args.groupIdByNote.get(m.id);
      const toggleGroupId = paired ?? crypto.randomUUID();
      if (paired == null) {
        await tx.insert(scenarioToggleGroups).values({
          id: toggleGroupId,
          scenarioId: args.scenarioId,
          name: v.name,
          defaultOn: true,
          orderIndex: orderIndex++,
        });
      }
      await tx.insert(notesReceivable).values({
        id: rowId,
        clientId: args.clientId,
        scenarioId: args.baseScenarioId,
        toggleGroupId,
        ...columns,
      });
    }

    // `owners` is non-empty and sums to 1 by schema (NOTE_RECEIVABLE_VALUE),
    // so this is an unconditional write — an empty array can no longer reach
    // here and silently strip an existing note's owners.
    await tx.insert(noteReceivableOwners).values(
      v.owners.map((o) => ({
        noteReceivableId: rowId,
        ...noteOwnerColumns(o),
        percent: String(o.percent),
      })),
    );
    if (v.extraPayments.length > 0) {
      await tx.insert(noteExtraPayments).values(
        v.extraPayments.map((e) => ({
          noteReceivableId: rowId,
          year: e.year,
          type: e.type,
          amount: String(e.amount),
        })),
      );
    }
  }
}

/**
 * Decide what to do with every note id these mutations name, BEFORE opening the
 * transaction, so an unrepresentable one 400s instead of half-writing.
 *
 * Keyed on the EXISTING row's `toggleGroupId`:
 *  - **no row yet** → insert under the mutation's own id.
 *  - **gated by a group this scenario owns** → update in place. This is what
 *    makes a PUT re-save idempotent rather than duplicating the note.
 *  - **`toggleGroupId IS NULL`** → REJECT. An ungated note is the base plan's
 *    and is visible in every scenario; rewriting it here would change all of
 *    them, and a scenario has no way to say "this base note looks different in
 *    me" — its only per-scenario lever is the toggle group, which hides the row
 *    outright.
 *  - **gated by ANOTHER scenario's group** → `opts.forkForeignGated` decides.
 *    POST forks: it writes a FRESH row id under the new scenario's own group
 *    and leaves the original alone. That is what makes a second "Save as
 *    scenario" from the same solver state work instead of 400ing — a normal
 *    flow, since the in-memory mutation list still names the note the first
 *    save created. The original stays invisible in the new scenario:
 *    `loadScenarioToggleGroups` loads only that scenario's own groups, so
 *    `resolveEffectiveToggleState` never produces a key for a foreign group id
 *    and the note filter's `effective[gid] === true` is false.
 *    PUT rejects instead — a note gated by another scenario cannot be in this
 *    scenario's effective tree, so a mutation naming one came from a stale
 *    client.
 */
export async function planNoteWrites(
  clientId: string,
  noteIds: readonly string[],
  ownedGroupIds: ReadonlySet<string>,
  opts: { forkForeignGated: boolean },
): Promise<{ writes: Map<string, NoteWrite>; rejectedIds: string[] }> {
  const writes = new Map<string, NoteWrite>(
    noteIds.map((id) => [id, { rowId: id, exists: false, toggleGroupId: null }]),
  );
  if (noteIds.length === 0) return { writes, rejectedIds: [] };

  const rows = await db
    .select({
      id: notesReceivable.id,
      toggleGroupId: notesReceivable.toggleGroupId,
    })
    .from(notesReceivable)
    .where(
      and(
        eq(notesReceivable.clientId, clientId),
        inArray(notesReceivable.id, [...noteIds]),
      ),
    );

  const rejectedIds: string[] = [];
  for (const r of rows) {
    if (r.toggleGroupId != null && ownedGroupIds.has(r.toggleGroupId)) {
      writes.set(r.id, {
        rowId: r.id,
        exists: true,
        toggleGroupId: r.toggleGroupId,
      });
    } else if (r.toggleGroupId != null && opts.forkForeignGated) {
      // A fork must NOT carry the original's group: that group belongs to
      // another scenario, so `loadScenarioToggleGroups` never returns it here
      // and the forked note would be invisible in the scenario that just
      // created it.
      writes.set(r.id, {
        rowId: crypto.randomUUID(),
        exists: false,
        toggleGroupId: null,
      });
    } else {
      rejectedIds.push(r.id);
    }
  }
  return { writes, rejectedIds };
}

/**
 * Every toggle group this save creates, and which change rows and notes carry
 * which id. TWO sources feed ONE map, resolved together BEFORE the change rows
 * are tagged:
 *
 *  1. revocable-trust FUNDING sets — N retitled accounts collapsed into one
 *     "technique" card. Cosmetic: the projection is identical either way.
 *  2. sales to trust — the source account's owner flip and its promissory note,
 *     which MUST share a group. Either half alone is a wrong number: with the
 *     note toggled off the asset sits in the trust and nothing is owed for it,
 *     so value leaves the taxable estate for free; with the flip toggled off
 *     the family keeps the asset AND collects the note payments, and the
 *     projection drains the linked trust's cash to pay them. The live
 *     sale-to-trust route shares one freshly minted group across both writes
 *     for exactly this reason.
 *
 * Resolving them together is the whole point. `persistNoteReceivables` runs
 * AFTER the change rows are inserted, so a group it minted for itself could
 * never reach the account half — that is how the two halves became
 * independently toggleable.
 *
 * The pairing is DECLARED by the mutation (`sourceAccountId`), never inferred:
 * a note whose `linkedTrustEntityId` is T cannot be matched to "the account
 * whose owners became [{entity: T, 100%}]" without mis-pairing two sales to the
 * same trust, and a plain revocable-trust funding retitle produces a
 * byte-identical `owners` shape.
 *
 * Sale entries are written to the map LAST so a sale wins a target a funding
 * group also claims: the funding group is cosmetic, the sale pairing moves
 * money.
 */
export function resolveToggleGroups(args: {
  scenarioId: string;
  drafts: readonly SolverScenarioChangeDraft[];
  noteMutations: readonly NoteMutation[];
  noteWrites: ReadonlyMap<string, NoteWrite>;
  /** The scenario's current groups — find-or-create by name keeps a funding
   *  re-save idempotent. POST passes [] (the scenario is one statement old). */
  existingGroups: readonly { id: string; name: string }[];
  workingTree: ClientData;
  startOrderIndex: number;
}): {
  groupIdByTarget: Map<string, string>;
  groupIdByNote: Map<string, string>;
  newGroupRows: FundingGroupRow[];
  /** The first `orderIndex` no row above has taken — where a note with no
   *  pairing numbers the group it mints for itself, so the two group sources
   *  cannot collide. */
  nextOrderIndex: number;
} {
  const { groupIdByTarget, newGroupRows } = resolveFundingGroupRows(
    revocableTrustFundingGroups([...args.drafts]),
    args.existingGroups,
    args.scenarioId,
    args.startOrderIndex,
  );

  const accountTargets = new Set(
    args.drafts.flatMap((d) => (d.targetKind === "account" ? [d.targetId] : [])),
  );
  const groupIdByNote = new Map<string, string>();
  const claimed = new Set<string>();
  for (const m of args.noteMutations) {
    const accountId = m.sourceAccountId;
    // Nothing to pair: a removed note, a note that is not a sale, or a sale
    // whose owner flip produced no draft (a PUT re-save where the scenario
    // already holds the flip, so there is no diff). Each falls back to the
    // note minting its own group, which is what happened before.
    if (m.value === null || accountId == null) continue;
    if (!accountTargets.has(accountId) || claimed.has(accountId)) continue;
    // A re-save: the note row already exists under a group this scenario owns
    // (planNoteWrites rejects any other kind), so reuse it instead of minting a
    // second group for the same sale. Keyed on the note ROW, not on the group's
    // name, so two sales of two same-named accounts stay separate.
    const existingId = args.noteWrites.get(m.id)?.toggleGroupId ?? null;
    const id = existingId ?? crypto.randomUUID();
    if (existingId == null) {
      const name =
        args.workingTree.accounts.find((a) => a.id === accountId)?.name ?? "asset";
      newGroupRows.push({
        id,
        scenarioId: args.scenarioId,
        name: `Sell ${name} to trust`,
        defaultOn: true,
        // Numbered after every funding row already in the array, so orderIndex
        // stays unique across both sources.
        orderIndex: args.startOrderIndex + newGroupRows.length,
      });
    }
    claimed.add(accountId);
    groupIdByTarget.set(accountId, id);
    groupIdByNote.set(m.id, id);
  }

  return {
    groupIdByTarget,
    groupIdByNote,
    newGroupRows,
    nextOrderIndex: args.startOrderIndex + newGroupRows.length,
  };
}

export type SaveSolverScenarioResult =
  | { ok: true; scenarioId: string }
  | { ok: false; rejectedNoteIds: string[] };

/**
 * Materialize solver mutations as a NEW scenario of this client, starting from
 * `source` ("base" or a scenario id the caller has already checked is this
 * client's). `{ ok: false }` names notes receivable this save cannot express;
 * nothing has been written. Throws on invalid mutation state (applyMutations),
 * and with nothing written when the scenario writer refuses a held change
 * (`ScenarioChangeRejectedError`).
 */
export async function saveSolverScenario(args: {
  clientId: string;
  firmId: string;
  source: string;
  name: string;
  mutations: SolverMutation[];
  seed?: number;
}): Promise<SaveSolverScenarioResult> {
  const { clientId, firmId, source, name, mutations, seed } = args;

  // The held editor changes, over the starting plan as on the Solver's screen,
  // so the controls' drafts (which skip held entries) diff against that. The
  // load gets its own copies: its cascades rewrite what they reach (a will's
  // bequests to a removed trust), and `held` is what the writer saves.
  const held = heldScenarioChanges(mutations);
  const { effectiveTree } = await loadEffectiveTree(
    clientId,
    firmId,
    source,
    {},
    heldScenarioChanges(mutations),
  );
  const drafts = mutationsToScenarioChanges(effectiveTree, clientId, mutations);

  // Throws on invalid mutation state, and the result is what the two
  // scenario-partitioned tables are written from: they are not scenario_changes,
  // so the drafts above never carry them.
  const workingTree = applyMutations(effectiveTree, mutations);

  const noteMutations = lastNoteMutationPerId(mutations);
  // A brand-new scenario owns no toggle groups yet, so every pre-existing row
  // is un-owned — but a GATED one forks rather than 400s, which is what lets
  // the advisor hit "Save as scenario" twice from the same solver state.
  const { writes: noteWrites, rejectedIds } = await planNoteWrites(
    clientId,
    noteMutations.map((m) => m.id),
    new Set(),
    { forkForeignGated: true },
  );
  if (rejectedIds.length > 0) return { ok: false, rejectedNoteIds: rejectedIds };

  const scenarioId = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(scenarios)
      .values({
        clientId,
        name,
        isBaseCase: false,
        monteCarloSeed: seed ?? null,
      })
      .returning();

    // Seed the new scenario's recurring-gift partition from the scenario the
    // solver was run against. `gift_series` is scenario-partitioned, so
    // without this the saved scenario projects with the client's recurring
    // gifts missing — and promoting it would delete them from the base plan.
    const seriesSourceId =
      source === "base" ? await findBaseScenarioId(tx, clientId) : source;
    if (seriesSourceId) {
      await cloneGiftSeriesIntoScenario(tx, {
        clientId,
        fromScenarioId: seriesSourceId,
        toScenarioId: row.id,
      });
      // Same partition hazard, one table over: without this the saved
      // scenario projects each trust on base+growth rather than the
      // advisor's flow grid. Must run BEFORE the replace below so an edited
      // entity's copied rows are the ones replaced.
      await cloneEntityFlowOverridesIntoScenario(tx, {
        fromScenarioId: seriesSourceId,
        toScenarioId: row.id,
      });
    }

    await persistEntityFlowOverrides(
      tx,
      row.id,
      mutations,
      workingTree,
    );

    // Every toggle group this save needs, resolved BEFORE the change rows
    // below are tagged: one per revocable-trust funding set (N retitled
    // accounts collapse into a single card) and one per sale to trust (the
    // owner flip and its note flip together). A fresh scenario has no
    // existing groups, so every one of them is created here.
    const {
      groupIdByTarget,
      groupIdByNote,
      newGroupRows,
      nextOrderIndex,
    } = resolveToggleGroups({
      scenarioId: row.id,
      drafts,
      noteMutations,
      noteWrites,
      existingGroups: [],
      workingTree,
      startOrderIndex: 0,
    });
    if (newGroupRows.length > 0) {
      // .returning() result is intentionally unused (ids are client-generated);
      // kept for parity with the scenarioChanges insert below.
      await tx.insert(scenarioToggleGroups).values(newGroupRows).returning();
    }

    // Held changes go through the writer. A control aimed at an item one
    // touches follows it through the writer, which merges it into that item's
    // row (a second insert would collide on the unique index), so the control
    // wins as it does on screen, and keeps the group its target got above.
    const scope = { scenarioId: row.id as string, firmId };
    for (const change of held) await writeThroughWriter(tx, scope, change);
    const heldTargets = new Set(held.map(targetKeyOf));
    const direct: SolverScenarioChangeDraft[] = [];
    for (const d of drafts) {
      if (heldTargets.has(targetKeyOf(d))) {
        await writeThroughWriter(tx, scope, d, groupIdByTarget.get(d.targetId));
      } else {
        direct.push(d);
      }
    }

    if (direct.length > 0) {
      await tx
        .insert(scenarioChanges)
        .values(
          direct.map((d) => ({
            scenarioId: row.id,
            opType: d.opType,
            targetKind: d.targetKind,
            targetId: d.targetId,
            payload: d.payload,
            toggleGroupId: groupIdByTarget.get(d.targetId) ?? null,
            orderIndex: d.orderIndex,
            enabled: true,
          })),
        )
        .returning();
    }

    if (noteMutations.length > 0) {
      // Notes live on the client's BASE partition whatever scenario they
      // belong to — see persistNoteReceivables. When the solver ran off a
      // named scenario that isn't base, look base up explicitly.
      const baseScenarioId =
        source === "base" ? seriesSourceId : await findBaseScenarioId(tx, clientId);
      if (!baseScenarioId) {
        throw new Error(
          `Client ${clientId} has no base case scenario; cannot persist notes receivable`,
        );
      }
      await persistNoteReceivables(
        tx,
        {
          clientId,
          scenarioId: row.id,
          baseScenarioId,
          writes: noteWrites,
          groupIdByNote,
          groupOrderStart: nextOrderIndex,
        },
        noteMutations,
      );
    }

    return row.id as string;
  });

  return { ok: true, scenarioId };
}
