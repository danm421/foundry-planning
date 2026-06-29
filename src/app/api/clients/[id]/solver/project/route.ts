// src/app/api/clients/[id]/solver/project/route.ts
//
// POST /api/clients/[id]/solver/project
//
// Deterministic recompute endpoint for the Live Solver. Fired on every
// debounced edit. Read-only — no audit row.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runProjection, runProjectionWithEvents } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import type { SolverMutation, SolverProjectResponse } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { serializeProjectionResponse } from "@/lib/solver/projection-wire";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import {
  checkProjectionRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";

export const dynamic = "force-dynamic";

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
  includeEvents: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const callerOrg = await requireOrgId();

    const rl = await checkProjectionRateLimit(callerOrg);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many projection requests. Please wait a moment and try again.",
      );
    }

    const { id: clientId } = await ctx.params;

    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
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
    const { source, mutations } = parsed.data;

    const { effectiveTree, resolutionContext } = await loadEffectiveTree(
      clientId,
      access.firmId,
      source,
      {},
    );
    let mutated = applyMutations(effectiveTree, mutations as SolverMutation[]);
    if (resolutionContext) {
      mutated = resolveTechniqueMutations(
        mutated,
        mutations as SolverMutation[],
        resolutionContext,
      );
    }
    let projection;
    let projectionResult;
    if (parsed.data.includeEvents) {
      projectionResult = runProjectionWithEvents(mutated);
      projection = projectionResult.years;
    } else {
      projection = runProjection(mutated);
    }

    const body: SolverProjectResponse = { projection, projectionResult };
    // Custom serializer: ProjectionYear carries Map fields (…AccountSharesEoY,
    // entityCashFlow, …) that NextResponse.json would flatten to `{}`, crashing
    // estate consumers that call `field?.get(...)`. See projection-wire.ts.
    return new NextResponse(serializeProjectionResponse(body), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /api/clients/[id]/solver/project error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
