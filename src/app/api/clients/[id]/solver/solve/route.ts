// src/app/api/clients/[id]/solver/solve/route.ts
//
// POST /api/clients/[id]/solver/solve
//
// Server-Sent Events endpoint for the goal-seek solver. Bisects on a single
// lever, streaming one `progress` event per iteration followed by exactly one
// terminal `result` or `error` event. Read-only on the DB; no audit row.

import { NextRequest } from "next/server";
import { z } from "zod";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { solveTarget } from "@/lib/solver/solve-target";
import type { SolverMutation } from "@/lib/solver/types";
import type { SolveLeverKey, SolveSseEventName } from "@/lib/solver/solve-types";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";

export const dynamic = "force-dynamic";

const TARGET = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("retirement-age"), person: z.enum(["client", "spouse"]) }),
  z.object({ kind: z.literal("living-expense-scale") }),
  z.object({ kind: z.literal("savings-contribution"), accountId: z.string().min(1) }),
  z.object({ kind: z.literal("ss-claim-age"), person: z.enum(["client", "spouse"]) }),
]);

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
  target: TARGET,
  targetPoS: z.number().min(0.01).max(0.99),
});

type RouteCtx = { params: Promise<{ id: string }> };

function sseChunk(event: SolveSseEventName, payload: unknown): string {
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

  const inFirm = await findClientInFirm(clientId, firmId);
  if (!inFirm) {
    return new Response(JSON.stringify({ error: "Client not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  const raw = await req.json();
  const parsed = BODY.safeParse(raw);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid body", details: parsed.error.flatten() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const { source, mutations, target, targetPoS } = parsed.data;

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SolveSseEventName, payload: unknown) => {
        controller.enqueue(encoder.encode(sseChunk(event, payload)));
      };
      try {
        const { effectiveTree } = await loadEffectiveTree(clientId, firmId, source, {});
        const mcPayload = await loadMonteCarloData(clientId, firmId);
        const result = await solveTarget({
          effectiveTree,
          mcPayload,
          baselineMutations: mutations as SolverMutation[],
          target: target as SolveLeverKey,
          targetPoS,
          onProgress: (p) => emit("progress", p),
          signal: abortController.signal,
        });
        emit("result", result);
      } catch (err) {
        console.error("POST /api/clients/[id]/solver/solve error:", err);
        emit("error", {
          message: err instanceof Error ? err.message : "Internal server error",
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
