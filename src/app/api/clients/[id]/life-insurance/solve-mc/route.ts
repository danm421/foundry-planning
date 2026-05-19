// src/app/api/clients/[id]/life-insurance/solve-mc/route.ts
//
// POST /api/clients/[id]/life-insurance/solve-mc
//
// Server-Sent Events endpoint for the Monte Carlo life-insurance need solver.
// Bisects on face value against an MC probability-of-success target, streaming
// one `progress` event per candidate evaluation followed by exactly one
// terminal `result` (or `error`) event. The MC solve is slow — 250 trials ×
// ~24 bisection iterations × up to 2 decedents — hence the stream.
//
// Pure COMPUTE route — loads the client tree and MC payload, runs Monte Carlo,
// never mutates the database. Allowlisted in the active-subscription lint for
// parity with solver/solve.
import { NextRequest } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { solveLifeInsuranceNeedMc } from "@/lib/life-insurance/solve-need-mc";
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

  const inFirm = await findClientInFirm(clientId, firmId);
  if (!inFirm) {
    return new Response(JSON.stringify({ error: "Client not found" }), {
      status: 404,
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
  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: SseEventName, payload: unknown) => {
        controller.enqueue(encoder.encode(sseChunk(event, payload)));
      };
      try {
        const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});
        const mcPayload = await loadMonteCarloData(clientId, firmId);
        // The survivor must end with at least the leave-to-heirs target — the
        // MC solver reads this floor off the payload (see solve-need-mc.ts).
        mcPayload.requiredMinimumAssetLevel = assumptions.leaveToHeirsAmount;

        const filingStatus = effectiveTree.client.filingStatus;
        const isMarried =
          filingStatus === "married_joint" || filingStatus === "married_separate";

        const client = await solveLifeInsuranceNeedMc(
          effectiveTree,
          "client",
          assumptions,
          mcPayload,
          {
            onProgress: (done, total) =>
              emit("progress", { case: "client", done, total }),
            signal: abortController.signal,
          },
        );

        const spouse = isMarried
          ? await solveLifeInsuranceNeedMc(
              effectiveTree,
              "spouse",
              assumptions,
              mcPayload,
              {
                onProgress: (done, total) =>
                  emit("progress", { case: "spouse", done, total }),
                signal: abortController.signal,
              },
            )
          : null;

        emit("result", { isMarried, client, spouse });
      } catch (err) {
        console.error("POST /api/clients/[id]/life-insurance/solve-mc error:", err);
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
