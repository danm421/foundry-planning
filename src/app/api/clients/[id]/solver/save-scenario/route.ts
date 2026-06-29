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
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios, scenarioChanges, scenarioToggleGroups } from "@/db/schema";
import { revocableTrustFundingGroups } from "@/lib/solver/revocable-trust-funding-group";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import type { SolverMutation, SolverSaveResponse } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
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

    // Sanity check — throws on invalid mutation state
    applyMutations(effectiveTree, mutations as SolverMutation[]);

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

      // Auto-create one toggle-group ("technique") per revocable-trust funding
      // set so the N retitled-account changes collapse into a single card in the
      // changes panel. defaultOn: true keeps the projection identical.
      const groupIdByTarget = new Map<string, string>();
      const groupRows = fundingGroups.map((g, i) => {
        const id = crypto.randomUUID();
        for (const t of g.targetIds) groupIdByTarget.set(t, id);
        return { id, scenarioId: row.id, name: g.name, defaultOn: true, orderIndex: i };
      });
      if (groupRows.length > 0) {
        await tx.insert(scenarioToggleGroups).values(groupRows).returning();
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
    const groupIdByTarget = new Map<string, string>();
    const newGroupRows: Array<{
      id: string; scenarioId: string; name: string; defaultOn: boolean; orderIndex: number;
    }> = [];
    for (const g of fundingGroups) {
      const existingGroup = existingGroups.find((eg) => eg.name === g.name);
      const id = existingGroup?.id ?? crypto.randomUUID();
      if (!existingGroup) {
        newGroupRows.push({
          id,
          scenarioId,
          name: g.name,
          defaultOn: true,
          orderIndex: existingGroups.length + newGroupRows.length,
        });
      }
      for (const t of g.targetIds) groupIdByTarget.set(t, id);
    }

    await db.transaction(async (tx) => {
      if (newGroupRows.length > 0) {
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
