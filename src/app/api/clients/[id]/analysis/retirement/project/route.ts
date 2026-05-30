// src/app/api/clients/[id]/analysis/retirement/project/route.ts
//
// POST — deterministic recompute for the Explore column. Applies the supplied
// mutations to the effective tree, runs runProjection, returns years + summary.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runProjection } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import { deriveRetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import type { SolverMutation } from "@/lib/solver/types";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";

export const dynamic = "force-dynamic";

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
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

    const parsed = BODY.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { source, mutations } = parsed.data;

    const { effectiveTree, resolutionContext } = await loadEffectiveTree(
      clientId,
      firmId,
      source,
      {},
    );
    let tree = applyMutations(effectiveTree, mutations as SolverMutation[]);
    if (resolutionContext) {
      tree = resolveTechniqueMutations(tree, mutations as SolverMutation[], resolutionContext);
    }
    const years = runProjection(tree);
    return NextResponse.json({ years, summary: deriveRetirementSummary(years) });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /analysis/retirement/project error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
