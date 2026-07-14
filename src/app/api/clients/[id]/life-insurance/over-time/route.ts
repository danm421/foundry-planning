// src/app/api/clients/[id]/life-insurance/over-time/route.ts
//
// POST /api/clients/[id]/life-insurance/over-time
//
// Server-Sent Events endpoint for the life-insurance need-over-time view.
// Runs the deterministic (straight-line) solver once per plan year, streaming
// one `progress` event per year solved followed by exactly one terminal
// `result` (or `error`) event carrying the full rows array.
//
// `computeNeedOverTime` is synchronous and deterministic — no Monte Carlo — so
// the stream simply drains its `onProgress` callback as it runs.
//
// Pure COMPUTE route — loads the client tree, runs projections, never mutates
// the database. Allowlisted in the active-subscription lint for parity with
// solver/solve and the other life-insurance routes.
import { NextRequest } from "next/server";
import { z } from "zod";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import {
  checkProjectionRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import type { SolverMutation } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { computeNeedOverTime } from "@/lib/life-insurance/need-over-time";
import {
  loadLiProceedsGrowth,
  DEFAULT_LI_GROWTH,
} from "@/lib/life-insurance/load-li-portfolio";
import type { LifeInsuranceAssumptions } from "@/lib/life-insurance/solve-need";
import { LI_ASSUMPTIONS_SCHEMA } from "@/lib/life-insurance/schema";

// The live solver posts its edited scenario as `source` (base or a saved
// scenario id) + `mutations` (unsaved lever/technique/goal edits), so the LI
// need curve reflects exactly the plan the advisor is building — the same
// working tree the portfolio chart uses (see /api/clients/[id]/solver/project).
// `source`/`mutations` supersede the legacy `assumptions.scenarioRef`, which the
// live routes no longer read. Mirrors the /solver/life-insurance-summary route.
const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]).default("base"),
  mutations: z.array(SOLVER_MUTATION_SCHEMA).default([]),
  assumptions: LI_ASSUMPTIONS_SCHEMA,
});

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

type SseEventName = "progress" | "result" | "error";

function sseChunk(event: SseEventName, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  let callerOrg: string;
  let clientId: string;
  try {
    callerOrg = await requireOrgId();
    ({ id: clientId } = await ctx.params);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return new Response(JSON.stringify(authResp.body), {
        status: authResp.status,
        headers: { "content-type": "application/json" },
      });
    }
    throw err;
  }

  // Rate-limit before opening the stream so a denial is a normal 429/503, not a
  // mid-stream error event. This route runs one deterministic projection per
  // plan year (40–60 engine runs), so it shares the projection budget like the
  // sibling solve / solve-mc routes (F6).
  const rl = await checkProjectionRateLimit(callerOrg);
  if (!rl.allowed) {
    return rateLimitErrorResponse(
      rl,
      "Too many solver requests. Please wait a moment and try again.",
    );
  }

  const access = await verifyClientAccess(clientId);
  if (!access.ok) {
    return new Response(JSON.stringify({ error: "Client not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const parsed = BODY.safeParse(await req.json());
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid body", details: parsed.error.flatten() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const { source, mutations, assumptions } = parsed.data;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SseEventName, payload: unknown) => {
        controller.enqueue(encoder.encode(sseChunk(event, payload)));
      };
      try {
        const [{ effectiveTree, resolutionContext }, proceeds] = await Promise.all([
          loadEffectiveTree(clientId, access.firmId, source, {}),
          loadLiProceedsGrowth(
            access.firmId,
            assumptions.modelPortfolioId,
            DEFAULT_LI_GROWTH,
          ),
        ]);
        // Working tree = source + live mutations, so the need curve reflects the
        // scenario the advisor is editing (matches /solver/project's derivation).
        let workingTree = applyMutations(effectiveTree, mutations as SolverMutation[]);
        if (resolutionContext) {
          workingTree = resolveTechniqueMutations(
            workingTree,
            mutations as SolverMutation[],
            resolutionContext,
          );
        }
        const overTimeAssumptions: Omit<LifeInsuranceAssumptions, "deathYear"> = {
          proceedsGrowthRate: proceeds.rate,
          proceedsRealization: proceeds.realization,
          leaveToHeirsAmount: assumptions.leaveToHeirsAmount,
          livingExpenseAtDeath: assumptions.livingExpenseAtDeath,
          payoffLiabilityIds: assumptions.payoffLiabilityIds,
        };

        const rows = computeNeedOverTime(
          workingTree,
          overTimeAssumptions,
          assumptions.coverEstateTaxes,
          (done, total) => emit("progress", { done, total }),
        );

        emit("result", { rows });
      } catch (err) {
        console.error(
          "POST /api/clients/[id]/life-insurance/over-time error:",
          err,
        );
        emit("error", {
          message: "Internal server error",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
