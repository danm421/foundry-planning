// src/app/api/clients/[id]/solver/monte-carlo/route.ts
//
// POST /api/clients/[id]/solver/monte-carlo
//
// Probability-of-success for the Live Solver's gauges. Returns { successRate }.
// Served from cache (persistent per-scenario for unedited trees, transient
// solver_mc_cache for edited ones) and computed server-side on a miss, so the
// browser never blocks. Read-only — no audit row.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import type { SolverMutation } from "@/lib/solver/types";
import { getOrComputeSolverMc, getOrComputeSolverMcReport } from "@/lib/compute-cache/solver-mc";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import {
  checkProjectionRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
  forceRefresh: z.boolean().optional(),
  extraAccountMixes: z
    .array(
      z.object({
        accountId: z.string().min(1),
        mix: z.array(z.object({ assetClassId: z.string().min(1), weight: z.number() })),
      }),
    )
    .optional(),
  full: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const callerOrg = await requireOrgId();

    const rl = await checkProjectionRateLimit(callerOrg);
    if (!rl.allowed) {
      return rateLimitErrorResponse(
        rl,
        "Too many Monte Carlo requests. Please wait a moment and try again.",
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
    const { source, mutations, forceRefresh, extraAccountMixes, full } = parsed.data;

    if (full) {
      const report = await getOrComputeSolverMcReport({
        clientId, firmId: access.firmId, source, mutations: mutations as SolverMutation[],
        ...(extraAccountMixes ? { extraAccountMixes } : {}),
        ...(forceRefresh ? { forceRefresh } : {}),
      });
      return NextResponse.json(report);
    }

    const result = await getOrComputeSolverMc({
      clientId,
      firmId: access.firmId,
      source,
      mutations: mutations as SolverMutation[],
      ...(extraAccountMixes ? { extraAccountMixes } : {}),
      ...(forceRefresh ? { forceRefresh } : {}),
    });

    return NextResponse.json(result);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /api/clients/[id]/solver/monte-carlo error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
