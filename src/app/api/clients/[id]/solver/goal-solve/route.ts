// src/app/api/clients/[id]/solver/goal-solve/route.ts
//
// POST /api/clients/[id]/solver/goal-solve
//
// Live "solve" for the solver Goals tab. Given a working tree (source +
// unsaved mutations), a goal, and one of its savings accounts, finds
// the smallest additional annual contribution to that account that funds
// `targetPct` of the goal (default: all of it). Runs the REAL engine projection
// server-side (heavy: a bisection that re-projects per iteration). Pure COMPUTE
// route: reads the client tree, never mutates.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runProjection } from "@/engine";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { checkProjectionRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import type { SolverMutation } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { solveGoalDedicatedSavings } from "@/lib/solver/solve-goal-dedicated-savings";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
  goalId: z.string().min(1),
  accountId: z.string().min(1),
  /** Share of the goal to fund, 0–1. Absent = fund it fully. */
  targetPct: z.number().min(0).max(1).optional(),
  /** The Goals tab's "now" — the year it applies the result in, and the year
   *  both goal forms stamp on the rules they write. Solving in the same year is
   *  what makes the solve and Apply pick the same savings rule. Absent (a tab
   *  opened before this field existed) = the plan's first projection year. */
  currentYear: z.number().int().min(1900).max(2200).optional(),
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
    const { source, mutations, goalId, accountId, targetPct, currentYear: postedYear } = parsed.data;

    // ── Working tree (source + live mutations), so the solve reflects unsaved
    //    solver changes — mirrors the life-insurance-summary route. ──
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

    const currentYear =
      postedYear ?? runProjection(workingTree)[0]?.year ?? new Date().getFullYear();
    const result = solveGoalDedicatedSavings({
      tree: workingTree,
      goalId,
      accountId,
      currentYear,
      runProjection,
      targetPct,
    });

    return NextResponse.json(result);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/clients/[id]/solver/goal-solve error:", err);
    return NextResponse.json({ error: "Solve failed" }, { status: 500 });
  }
}
