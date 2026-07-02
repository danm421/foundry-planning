// src/app/api/clients/[id]/solver/life-insurance-summary/route.ts
//
// POST /api/clients/[id]/solver/life-insurance-summary
//
// Live "Run analysis" for the solver Summary → Life Insurance tab. Solves the
// working tree (source + unsaved mutations) into the same `LiSolved` payload the
// presentation deck / PDF export produces via `getOrComputeLifeInsuranceSolve`.
// Run-button gated (heavy: over-time curve + client/spouse 250-trial Monte Carlo)
// — never fired on edit. Pure COMPUTE route: reads the client tree, never mutates.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { checkProjectionRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import type { SolverMutation } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { LI_ASSUMPTIONS_SCHEMA } from "@/lib/life-insurance/schema";
import {
  loadLiProceedsGrowth,
  DEFAULT_LI_GROWTH,
} from "@/lib/life-insurance/load-li-portfolio";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { SYNTHETIC_POLICY_ID } from "@/engine/what-if/life-insurance-need";
import { computeLiSolved, CANONICAL_TRIALS } from "@/lib/compute-cache/life-insurance";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
  assumptions: LI_ASSUMPTIONS_SCHEMA,
  /** Display label for the resolved LI-proceeds portfolio — carried verbatim
   *  into `LiSolved.assumptions.modelPortfolioLabel` (display only). */
  modelPortfolioLabel: z.string(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const callerOrg = await requireOrgId();

    const rl = await checkProjectionRateLimit(callerOrg);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many solver requests. Please wait a moment and try again.",
      );
    }

    const { id: clientId } = await ctx.params;
    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const firmId = access.firmId;

    const parsed = BODY.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { source, mutations, assumptions, modelPortfolioLabel } = parsed.data;

    // ── Working tree (source + live mutations), so the LI need reflects unsaved
    //    solver changes — mirrors the retirement-comparison route. ──
    const { effectiveTree, resolutionContext } = await loadEffectiveTree(
      clientId,
      firmId,
      source,
      {},
    );
    let workingTree = applyMutations(effectiveTree, mutations as SolverMutation[]);
    if (resolutionContext) {
      workingTree = resolveTechniqueMutations(
        workingTree,
        mutations as SolverMutation[],
        resolutionContext,
      );
    }

    // ── Proceeds growth + MC payload with the synthetic-policy mix injected.
    //    MC returns/mixes stay base/firm-sourced (matching
    //    getOrComputeLifeInsuranceSolve); the working tree flows through the
    //    solve via `tree` below. ──
    const proceeds = await loadLiProceedsGrowth(
      firmId,
      assumptions.modelPortfolioId,
      DEFAULT_LI_GROWTH,
    );
    const mcPayload = await loadMonteCarloData(clientId, firmId, source, [
      { accountId: SYNTHETIC_POLICY_ID, mix: proceeds.mix },
    ]);

    const solved = await computeLiSolved({
      tree: workingTree,
      mcPayload,
      proceeds,
      assumptions,
      modelPortfolioLabel,
      trials: CANONICAL_TRIALS,
    });

    return NextResponse.json(solved);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/clients/[id]/solver/life-insurance-summary error:", err);
    return NextResponse.json({ error: "Solve failed" }, { status: 500 });
  }
}
