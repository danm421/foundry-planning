// src/app/api/clients/[id]/solver/solve/route.ts
//
// POST /api/clients/[id]/solver/solve
//
// Server-Sent Events endpoint for the goal-seek solver. Bisects on a single
// lever, streaming one `progress` event per iteration followed by exactly one
// terminal `result` or `error` event. Read-only on the DB; no audit row.

import { NextRequest } from "next/server";
import { SOLVE_REQUEST_SCHEMA } from "@/lib/solver/solve-request-schema";
import { solveTarget } from "@/lib/solver/solve-target";
import { solveSsClaimAgeByPortfolio } from "@/lib/solver/solve-ss-portfolio";
import type { SolverMutation } from "@/lib/solver/types";
import type { SolveLeverKey, SolveResultEvent, SolveSseEventName } from "@/lib/solver/solve-types";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import {
  checkProjectionRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

function sseChunk(event: SolveSseEventName, payload: unknown): string {
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

  // Rate-limit before opening the stream so a denial is a normal 429/503,
  // not a mid-stream error event. Shares the projection budget (engine run).
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

  const raw = await req.json();
  const parsed = SOLVE_REQUEST_SCHEMA.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid body", details: parsed.error.flatten() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const { source, mutations, target, targetPoS, extraAccountMixes } = parsed.data;

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SolveSseEventName, payload: unknown) => {
        controller.enqueue(encoder.encode(sseChunk(event, payload)));
      };
      try {
        const { effectiveTree, resolutionContext } = await loadEffectiveTree(clientId, access.firmId, source, {});
        let result: SolveResultEvent;
        if (target.kind === "ss-claim-age") {
          // Deterministic argmax over claim ages 62–70 on the straight-line
          // projection. No Monte Carlo → skip the MC payload load entirely.
          result = solveSsClaimAgeByPortfolio({
            effectiveTree,
            baselineMutations: mutations as SolverMutation[],
            person: target.person,
            resolutionContext,
            signal: abortController.signal,
          });
        } else {
          // Build the MC payload from a reinvestment-aware tree so "solve to
          // target" reflects a model-portfolio reinvestment's allocation switch
          // (a switch segment at ri.year), matching the deterministic search
          // tree and every other MC surface. The reinvestment arrives only as a
          // FIXED baseline mutation (never the searched lever — see
          // SolveLeverKey), so applying baseline mutations once produces the
          // correct static timeline. Mirrors solver-mc.ts:loadEditedInputs.
          let mixTree = applyMutations(effectiveTree, mutations as SolverMutation[]);
          if (resolutionContext) {
            mixTree = resolveTechniqueMutations(mixTree, mutations as SolverMutation[], resolutionContext);
          }
          // Seed off the SAME scenario the gauge/report use (loadEditedInputs
          // passes `source`, not "base"): each scenario row carries its own MC
          // seed, so a hardcoded "base" seed makes the solved PoS disagree with
          // the gauge rendered beside it for any non-base source. Account mixes /
          // volatility / correlations stay base/firm-sourced regardless of this
          // arg — only seed selection and startingLiquidBalance are source-aware.
          const mcPayload = await loadMonteCarloData(
            clientId,
            access.firmId,
            source,
            extraAccountMixes ?? [],
            mixTree,
          );
          result = await solveTarget({
            effectiveTree,
            mcPayload,
            baselineMutations: mutations as SolverMutation[],
            target: target as SolveLeverKey,
            targetPoS: targetPoS!,
            resolutionContext,
            onProgress: (p) => emit("progress", p),
            signal: abortController.signal,
          });
        }
        emit("result", result);
      } catch (err) {
        console.error("POST /api/clients/[id]/solver/solve error:", err);
        emit("error", {
          message: "Internal server error",
        });
      } finally {
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
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
