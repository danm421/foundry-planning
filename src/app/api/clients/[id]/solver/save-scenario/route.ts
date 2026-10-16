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
//
// The save itself — and the helpers PUT reuses — live in
// src/lib/solver/save-scenario.ts, shared with the Claude connector's
// save_what_if_as_scenario.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioToggleGroups } from "@/db/schema";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import type { SolverMutation, SolverSaveResponse } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import {
  lastNoteMutationPerId,
  persistEntityFlowOverrides,
  persistNoteReceivables,
  planNoteWrites,
  resolveToggleGroups,
  saveSolverScenario,
} from "@/lib/solver/save-scenario";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { findBaseScenarioId } from "@/lib/scenario/create-with-clone";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import {
  applyEntityAdd,
  applyEntityEdit,
  applyEntityRemove,
  ScenarioChangeRejectedError,
} from "@/lib/scenario/changes-writer";
import {
  SINGLETON_KIND_TO_FIELD,
  TARGET_KIND_TO_FIELD,
} from "@/engine/scenario/applyChanges";
import type { TargetKind } from "@/engine/scenario/types";
import type { ClientData } from "@/engine/types";
import { STRESS_TEST_FIELD } from "@/engine/stress-tests";
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

    const saved = await saveSolverScenario({
      clientId,
      firmId,
      source,
      name,
      mutations: mutations as SolverMutation[],
      seed,
    });
    if (!saved.ok) return unownedNoteResponse(saved.rejectedNoteIds);

    await recordAudit({
      action: "scenario.create",
      resourceType: "scenario",
      resourceId: saved.scenarioId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { source: "solver", mutationCount: mutations.length }),
    });

    const body: SolverSaveResponse = { scenarioId: saved.scenarioId };
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

const STRESS_OWNED_FIELDS: ReadonlySet<string> = new Set(Object.values(STRESS_TEST_FIELD));

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
    const existingEdits = new Map<string, Record<string, { to: unknown }>>();
    for (const c of existing) {
      if (c.opType !== "edit") continue;
      existingEdits.set(
        `${c.targetKind}:${c.targetId}`,
        (c.payload ?? {}) as Record<string, { to: unknown }>,
      );
    }
    // Ruling F-I1-put: the writer reads an omitted toggleGroupId as "keep the
    // row's group" (for the Details editors). A re-save here keeps its own,
    // older rule instead, stated explicitly: a target this save puts in no
    // group is unlinked (null) — except an edit the writer folds into an
    // existing `add` row, which keeps the add's group (omitted), as it always
    // did.
    const addedTargets = new Set(
      existing.filter((c) => c.opType === "add").map((c) => `${c.targetKind}:${c.targetId}`),
    );

    const existingGroups = await loadScenarioToggleGroups(scenarioId);

    const noteMutations = lastNoteMutationPerId(mutations as SolverMutation[]);
    // No fork here: this scenario already exists, so a note gated by a DIFFERENT
    // scenario cannot be in its effective tree and naming one is a stale client.
    // Runs BEFORE the groups are resolved because a sale's re-save reuses the
    // group its existing note row already carries.
    const { writes: noteWrites, rejectedIds } = await planNoteWrites(
      clientId,
      noteMutations.map((m) => m.id),
      new Set(existingGroups.map((g) => g.id)),
      { forkForeignGated: false },
    );
    if (rejectedIds.length > 0) return unownedNoteResponse(rejectedIds);

    // Find-or-create a toggle group per revocable-trust funding set so a re-save
    // collapses the retitled-account edits into one technique card (idempotent:
    // reuse a same-name group rather than duplicating it), plus one per sale to
    // trust so its owner flip and its note flip as one unit.
    const {
      groupIdByTarget,
      groupIdByNote,
      newGroupRows,
      nextOrderIndex,
    } = resolveToggleGroups({
      scenarioId,
      drafts,
      noteMutations,
      noteWrites,
      existingGroups,
      workingTree,
      startOrderIndex: existingGroups.length,
    });

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
          const stored = existingEdits.get(`${d.targetKind}:${d.targetId}`) ?? {};
          const fields = new Set<string>([
            ...Object.keys(stored),
            ...Object.keys((d.payload ?? {}) as Record<string, unknown>),
          ]);
          const desiredFields: Record<string, unknown> = {};
          for (const f of fields) {
            // A stress test writes its plan setting over every other change, so
            // the working tree holds the stress value there, not this row's.
            // Stressors save as their own changes, so a stored value came from
            // Assumptions or a legacy combined row: keep it.
            desiredFields[f] =
              targetKind === "plan_settings" && STRESS_OWNED_FIELDS.has(f) && f in stored
                ? stored[f].to
                : workingFieldValue(workingTree, targetKind, d.targetId, f);
          }
          const keepsAddGroup = !gid && addedTargets.has(`${d.targetKind}:${d.targetId}`);
          await applyEntityEdit({
            scenarioId,
            firmId,
            targetKind,
            targetId: d.targetId,
            desiredFields,
            ...(keepsAddGroup ? {} : { toggleGroupId: gid ?? null }),
            tx,
          });
        } else if (d.opType === "add") {
          await applyEntityAdd({
            scenarioId,
            firmId,
            targetKind,
            entity: d.payload as { id: string } & Record<string, unknown>,
            toggleGroupId: gid ?? null,
            tx,
          });
        } else {
          await applyEntityRemove({
            scenarioId,
            firmId,
            targetKind,
            targetId: d.targetId,
            toggleGroupId: null,
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
            groupIdByNote,
            groupOrderStart: nextOrderIndex,
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
    if (err instanceof ScenarioChangeRejectedError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("PUT /api/clients/[id]/solver/save-scenario error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
