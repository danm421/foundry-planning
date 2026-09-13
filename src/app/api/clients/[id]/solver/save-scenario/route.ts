// src/app/api/clients/[id]/solver/save-scenario/route.ts
//
// POST /api/clients/[id]/solver/save-scenario
//   Materializes an in-memory set of solver mutations as a NEW scenarios row
//   plus N scenarioChanges rows, committed in a single transaction.
//
// PUT  /api/clients/[id]/solver/save-scenario
//   Folds the solver mutations into an EXISTING scenario (the one currently
//   loaded as the solver source). Each mutation is routed through the
//   changes-writer — the only sanctioned path for non-base scenario_changes
//   writes — so the (scenarioId, targetKind, targetId, opType) unique index,
//   edit-of-add collapse, and revert-to-base deletion are all handled there.
//
// Both verbs also write the scenario-PARTITIONED tables directly:
// `gift_series` and `entity_flow_overrides` (cloned from the source partition,
// then replaced per entity from the working tree) and `notes_receivable` with
// its two child tables. None of these are scenario_changes rows, so the
// changes-writer never sees them and a save that skipped them would lose the
// advisor's recurring gifts, trust flow grids and IDGT notes.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
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
} from "@/lib/solver/revocable-trust-funding-group";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import type { SolverMutation, SolverSaveResponse } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  cloneEntityFlowOverridesIntoScenario,
  cloneGiftSeriesIntoScenario,
  findBaseScenarioId,
} from "@/lib/scenario/create-with-clone";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import {
  applyEntityAdd,
  applyEntityEdit,
  applyEntityRemove,
} from "@/lib/scenario/changes-writer";
import {
  SINGLETON_KIND_TO_FIELD,
  TARGET_KIND_TO_FIELD,
} from "@/engine/scenario/applyChanges";
import type { TargetKind } from "@/engine/scenario/types";
import type { ClientData } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA).min(1),
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/\S/, "name must not be empty"),
  /** MC seed from the canonical solve run. When present, stored on the
   *  scenario row so its report reproduces the same PoS. */
  seed: z.number().int().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

/** Loosely-typed tx handle — same derivation as create-with-clone's, because
 *  Drizzle does not export its tx callback param as a named type here. */
type SaveTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type NoteMutation = Extract<SolverMutation, { kind: "note-receivable-upsert" }>;

/** Which `notes_receivable` row a note mutation writes, and whether that row
 *  already exists. `rowId` is usually the mutation's own id; it differs only on
 *  the POST fork described in `planNoteWrites`. */
interface NoteWrite {
  rowId: string;
  exists: boolean;
}

const isNoteMutation = (m: SolverMutation): m is NoteMutation =>
  m.kind === "note-receivable-upsert";

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
function lastNoteMutationPerId(
  mutations: readonly SolverMutation[],
): NoteMutation[] {
  const byId = new Map<string, NoteMutation>();
  for (const m of mutations) {
    if (isNoteMutation(m)) byId.set(m.id, m);
  }
  return [...byId.values()];
}

/** The 400 both verbs return for a note that cannot be expressed as a change to
 *  this scenario. Shared so the two call sites cannot drift apart. */
function unownedNoteResponse(noteIds: string[]) {
  return NextResponse.json(
    {
      error:
        "Cannot change a note receivable that belongs to the base plan or another scenario",
      noteIds,
    },
    { status: 400 },
  );
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
async function persistEntityFlowOverrides(
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
async function persistNoteReceivables(
  tx: SaveTx,
  args: {
    clientId: string;
    scenarioId: string;
    baseScenarioId: string;
    writes: ReadonlyMap<string, NoteWrite>;
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
      const toggleGroupId = crypto.randomUUID();
      await tx.insert(scenarioToggleGroups).values({
        id: toggleGroupId,
        scenarioId: args.scenarioId,
        name: v.name,
        defaultOn: true,
        orderIndex: orderIndex++,
      });
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
async function planNoteWrites(
  clientId: string,
  noteIds: readonly string[],
  ownedGroupIds: ReadonlySet<string>,
  opts: { forkForeignGated: boolean },
): Promise<{ writes: Map<string, NoteWrite>; rejectedIds: string[] }> {
  const writes = new Map<string, NoteWrite>(
    noteIds.map((id) => [id, { rowId: id, exists: false }]),
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
      writes.set(r.id, { rowId: r.id, exists: true });
    } else if (r.toggleGroupId != null && opts.forkForeignGated) {
      writes.set(r.id, { rowId: crypto.randomUUID(), exists: false });
    } else {
      rejectedIds.push(r.id);
    }
  }
  return { writes, rejectedIds };
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const raw = await req.json();
    const parsed = BODY.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { source, mutations, name, seed } = parsed.data;

    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, source, {});
    const drafts = mutationsToScenarioChanges(
      effectiveTree,
      clientId,
      mutations as SolverMutation[],
    );

    // Throws on invalid mutation state, and the result is what the two
    // scenario-partitioned tables are written from: they are not scenario_changes,
    // so the drafts above never carry them.
    const workingTree = applyMutations(effectiveTree, mutations as SolverMutation[]);

    const noteMutations = lastNoteMutationPerId(mutations as SolverMutation[]);
    // A brand-new scenario owns no toggle groups yet, so every pre-existing row
    // is un-owned — but a GATED one forks rather than 400s, which is what lets
    // the advisor hit "Save as scenario" twice from the same solver state.
    const { writes: noteWrites, rejectedIds } = await planNoteWrites(
      clientId,
      noteMutations.map((m) => m.id),
      new Set(),
      { forkForeignGated: true },
    );
    if (rejectedIds.length > 0) return unownedNoteResponse(rejectedIds);

    const fundingGroups = revocableTrustFundingGroups(drafts);

    const newScenarioId = await db.transaction(async (tx) => {
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
        mutations as SolverMutation[],
        workingTree,
      );

      // Auto-create one toggle-group ("technique") per revocable-trust funding
      // set so the N retitled-account changes collapse into a single card in the
      // changes panel. defaultOn: true keeps the projection identical. A fresh
      // scenario has no existing groups, so this always creates.
      const { groupIdByTarget, newGroupRows } = resolveFundingGroupRows(
        fundingGroups,
        [],
        row.id,
        0,
      );
      if (newGroupRows.length > 0) {
        // .returning() result is intentionally unused (ids are client-generated);
        // kept for parity with the scenarioChanges insert below.
        await tx.insert(scenarioToggleGroups).values(newGroupRows).returning();
      }

      if (drafts.length > 0) {
        await tx
          .insert(scenarioChanges)
          .values(
            drafts.map((d) => ({
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
            groupOrderStart: newGroupRows.length,
          },
          noteMutations,
        );
      }

      return row.id as string;
    });

    await recordAudit({
      action: "scenario.create",
      resourceType: "scenario",
      resourceId: newScenarioId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { source: "solver", mutationCount: mutations.length }),
    });

    const body: SolverSaveResponse = { scenarioId: newScenarioId };
    return NextResponse.json(body);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /api/clients/[id]/solver/save-scenario error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

const UPDATE_BODY = z.object({
  /** The scenario to fold the mutations into (the live solver source). */
  scenarioId: z.string().uuid(),
  mutations: z.array(SOLVER_MUTATION_SCHEMA).min(1),
  /** MC seed from the canonical solve run. When present, replaces the
   *  scenario's stored seed so its report reproduces the latest PoS. */
  seed: z.number().int().optional(),
});

/**
 * Read a single field off the working tree for `(targetKind, targetId)`.
 * Singletons (client / plan_settings) live as one object on ClientData; list
 * kinds are matched by id. Returns undefined when the entity isn't present.
 */
function workingFieldValue(
  tree: ClientData,
  targetKind: TargetKind,
  targetId: string,
  field: string,
): unknown {
  const singletonField = SINGLETON_KIND_TO_FIELD[targetKind];
  if (singletonField != null) {
    const singleton = tree[singletonField] as unknown as Record<string, unknown>;
    return singleton[field];
  }
  const listField = TARGET_KIND_TO_FIELD[targetKind];
  if (listField == null) return undefined;
  const arr = tree[listField] as unknown as Array<{ id: string }> | undefined;
  const entity = arr?.find((e) => e.id === targetId) as
    | Record<string, unknown>
    | undefined;
  return entity?.[field];
}

export async function PUT(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const raw = await req.json();
    const parsed = UPDATE_BODY.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { scenarioId, mutations, seed } = parsed.data;

    // The scenario must belong to this client and not be the base case — base
    // edits go through Save to base facts, not the scenario overlay.
    const [scenarioRow] = await db
      .select({ id: scenarios.id, isBaseCase: scenarios.isBaseCase })
      .from(scenarios)
      .where(and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)));
    if (!scenarioRow) {
      return NextResponse.json({ error: "Scenario not found" }, { status: 404 });
    }
    if (scenarioRow.isBaseCase) {
      return NextResponse.json(
        { error: "Cannot update the base case; use Save to base facts" },
        { status: 400 },
      );
    }

    // The solver source IS this scenario, so its mutations are deltas on the
    // scenario's current effective tree. Convert them to draft changes (which
    // coalesce per-target) and compute the working tree once so per-field
    // values can be read back when rewriting edit rows.
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenarioId, {});
    const workingTree = applyMutations(effectiveTree, mutations as SolverMutation[]);
    const drafts = mutationsToScenarioChanges(
      effectiveTree,
      clientId,
      mutations as SolverMutation[],
    );

    // The changes-writer rewrites an entire edit row's payload, so a partial
    // re-edit must carry the scenario's already-edited fields too — otherwise
    // they'd be dropped. Collect the field set of each existing edit row and
    // union it with the new draft's fields, reading every value off the
    // working tree (the writer then diffs each against base).
    const existing = await loadScenarioChanges(scenarioId);
    const existingEditFields = new Map<string, string[]>();
    for (const c of existing) {
      if (c.opType !== "edit") continue;
      existingEditFields.set(
        `${c.targetKind}:${c.targetId}`,
        Object.keys((c.payload ?? {}) as Record<string, unknown>),
      );
    }

    // Find-or-create a toggle group per revocable-trust funding set so a re-save
    // collapses the retitled-account edits into one technique card (idempotent:
    // reuse a same-name group rather than duplicating it).
    const fundingGroups = revocableTrustFundingGroups(drafts);
    const existingGroups = await loadScenarioToggleGroups(scenarioId);
    const { groupIdByTarget, newGroupRows } = resolveFundingGroupRows(
      fundingGroups,
      existingGroups,
      scenarioId,
      existingGroups.length,
    );

    const noteMutations = lastNoteMutationPerId(mutations as SolverMutation[]);
    // No fork here: this scenario already exists, so a note gated by a DIFFERENT
    // scenario cannot be in its effective tree and naming one is a stale client.
    const { writes: noteWrites, rejectedIds } = await planNoteWrites(
      clientId,
      noteMutations.map((m) => m.id),
      new Set(existingGroups.map((g) => g.id)),
      { forkForeignGated: false },
    );
    if (rejectedIds.length > 0) return unownedNoteResponse(rejectedIds);

    await db.transaction(async (tx) => {
      if (newGroupRows.length > 0) {
        // .returning() result is intentionally unused (ids are client-generated);
        // kept for parity with the scenarioChanges insert below.
        await tx.insert(scenarioToggleGroups).values(newGroupRows).returning();
      }
      for (const d of drafts) {
        const targetKind = d.targetKind as TargetKind;
        const gid = groupIdByTarget.get(d.targetId);
        if (d.opType === "edit") {
          const fields = new Set<string>([
            ...(existingEditFields.get(`${d.targetKind}:${d.targetId}`) ?? []),
            ...Object.keys((d.payload ?? {}) as Record<string, unknown>),
          ]);
          const desiredFields: Record<string, unknown> = {};
          for (const f of fields) {
            desiredFields[f] = workingFieldValue(workingTree, targetKind, d.targetId, f);
          }
          await applyEntityEdit({
            scenarioId,
            firmId,
            targetKind,
            targetId: d.targetId,
            desiredFields,
            ...(gid ? { toggleGroupId: gid } : {}),
            tx,
          });
        } else if (d.opType === "add") {
          await applyEntityAdd({
            scenarioId,
            firmId,
            targetKind,
            entity: d.payload as { id: string } & Record<string, unknown>,
            ...(gid ? { toggleGroupId: gid } : {}),
            tx,
          });
        } else {
          await applyEntityRemove({
            scenarioId,
            firmId,
            targetKind,
            targetId: d.targetId,
            tx,
          });
        }
      }
      // The two scenario-PARTITIONED tables, which the changes-writer above
      // never sees. Omitting them here would make "update this scenario" quietly
      // drop what "save as a new scenario" keeps. No clone: the target scenario
      // already has its own partition.
      await persistEntityFlowOverrides(
        tx,
        scenarioId,
        mutations as SolverMutation[],
        workingTree,
      );

      if (noteMutations.length > 0) {
        const baseScenarioId = await findBaseScenarioId(tx, clientId);
        if (!baseScenarioId) {
          throw new Error(
            `Client ${clientId} has no base case scenario; cannot persist notes receivable`,
          );
        }
        await persistNoteReceivables(
          tx,
          {
            clientId,
            scenarioId,
            baseScenarioId,
            writes: noteWrites,
            groupOrderStart: existingGroups.length + newGroupRows.length,
          },
          noteMutations,
        );
      }

      if (seed !== undefined) {
        await tx
          .update(scenarios)
          .set({ monteCarloSeed: seed })
          .where(eq(scenarios.id, scenarioId));
      }
    });

    await recordAudit({
      action: "scenario_change.upsert",
      resourceType: "scenario",
      resourceId: scenarioId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        source: "solver",
        mutationCount: mutations.length,
      }),
    });

    const body: SolverSaveResponse = { scenarioId };
    return NextResponse.json(body);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("PUT /api/clients/[id]/solver/save-scenario error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
