// src/app/api/clients/[id]/solver/save-scenario/route.ts
//
// POST /api/clients/[id]/solver/save-scenario
//
// Materializes an in-memory set of solver mutations as a new scenarios row
// plus N scenarioChanges rows, committed in a single transaction.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { scenarios, scenarioChanges } from "@/db/schema";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { mutationsToScenarioChanges } from "@/lib/solver/mutations-to-scenario-changes";
import type { SolverMutation, SolverSaveResponse } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA).min(1),
  name: z
    .string()
    .min(1)
    .max(60)
    .regex(/\S/, "name must not be empty"),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await ctx.params;

    const inFirm = await findClientInFirm(clientId, firmId);
    if (!inFirm) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const raw = await req.json();
    const parsed = BODY.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { source, mutations, name } = parsed.data;

    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, source, {});
    const drafts = mutationsToScenarioChanges(
      effectiveTree,
      clientId,
      mutations as SolverMutation[],
    );

    // Sanity check — throws on invalid mutation state
    applyMutations(effectiveTree, mutations as SolverMutation[]);

    const newScenarioId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(scenarios)
        .values({
          clientId,
          name,
          isBaseCase: false,
        })
        .returning();

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
              toggleGroupId: null,
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
      metadata: { source: "solver", mutationCount: mutations.length },
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
