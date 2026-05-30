// src/app/api/clients/[id]/analysis/retirement/pos/route.ts
//
// POST — Monte Carlo probability-of-success for the Retirement Analysis
// probability view. Applies the supplied mutations to the effective tree,
// runs runMonteCarlo (1 000 trials), and returns { successRate }.
//
// Read-only on the DB; no audit row.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createReturnEngine, runMonteCarlo } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import type { SolverMutation } from "@/lib/solver/types";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";

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

    const mcPayload = await loadMonteCarloData(clientId, firmId);
    const accountMixes = new Map(
      mcPayload.accountMixes.map((a) => [a.accountId, a.mix]),
    );
    const returnEngine = createReturnEngine({
      indices: mcPayload.indices,
      correlation: mcPayload.correlation,
      seed: mcPayload.seed,
    });

    const abortController = new AbortController();
    req.signal.addEventListener("abort", () => abortController.abort());

    const mc = await runMonteCarlo({
      data: tree,
      returnEngine,
      accountMixes,
      trials: 1000,
      requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
      signal: abortController.signal,
      yieldEvery: 50,
    });

    return NextResponse.json({ successRate: mc.successRate });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /analysis/retirement/pos error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
