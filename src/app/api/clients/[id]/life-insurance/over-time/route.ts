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
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import {
  checkProjectionRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { computeNeedOverTime } from "@/lib/life-insurance/need-over-time";
import {
  loadLiProceedsGrowth,
  DEFAULT_LI_GROWTH,
} from "@/lib/life-insurance/load-li-portfolio";
import type { LifeInsuranceAssumptions } from "@/lib/life-insurance/solve-need";
import { LI_ASSUMPTIONS_SCHEMA } from "@/lib/life-insurance/schema";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

type SseEventName = "progress" | "result" | "error";

function sseChunk(event: SseEventName, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  let firmId: string;
  let clientId: string;
  try {
    firmId = await requireOrgId();
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
  const rl = await checkProjectionRateLimit(firmId);
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
  if (access.permission !== "edit") {
    return new Response(JSON.stringify({ error: "View-only access" }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  const parsed = LI_ASSUMPTIONS_SCHEMA.safeParse(await req.json());
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid body", details: parsed.error.flatten() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const assumptions = parsed.data;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SseEventName, payload: unknown) => {
        controller.enqueue(encoder.encode(sseChunk(event, payload)));
      };
      try {
        const [{ effectiveTree }, proceeds] = await Promise.all([
          loadEffectiveTree(clientId, firmId, assumptions.scenarioRef, {}),
          loadLiProceedsGrowth(
            firmId,
            assumptions.modelPortfolioId,
            DEFAULT_LI_GROWTH,
          ),
        ]);
        const overTimeAssumptions: Omit<LifeInsuranceAssumptions, "deathYear"> = {
          proceedsGrowthRate: proceeds.rate,
          proceedsRealization: proceeds.realization,
          leaveToHeirsAmount: assumptions.leaveToHeirsAmount,
          livingExpenseAtDeath: assumptions.livingExpenseAtDeath,
          payoffLiabilityIds: assumptions.payoffLiabilityIds,
        };

        const rows = computeNeedOverTime(effectiveTree, overTimeAssumptions, (done, total) =>
          emit("progress", { done, total }),
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
