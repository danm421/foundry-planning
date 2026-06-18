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
import {
  checkProjectionRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { solveLifeInsuranceNeedMc } from "@/lib/life-insurance/solve-need-mc";
import { hasSpouse } from "@/lib/life-insurance/need-over-time";
import { computeEstateTaxAddend } from "@/lib/life-insurance/estate-tax-addend";
import { LI_ASSUMPTIONS_SCHEMA } from "@/lib/life-insurance/schema";
import {
  loadLiProceedsGrowth,
  DEFAULT_LI_GROWTH,
} from "@/lib/life-insurance/load-li-portfolio";
import { SYNTHETIC_POLICY_ID } from "@/engine/what-if/life-insurance-need";
import type { LifeInsuranceAssumptions } from "@/lib/life-insurance/solve-need";

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
        const [{ effectiveTree }, proceeds] = await Promise.all([
          loadEffectiveTree(clientId, access.firmId, assumptions.scenarioRef, {}),
          loadLiProceedsGrowth(
            access.firmId,
            assumptions.modelPortfolioId,
            DEFAULT_LI_GROWTH,
          ),
        ]);

        // Inject the synthetic policy's model-portfolio mix so the §101
        // proceeds randomize through Monte Carlo. The transformed payout
        // account keeps id === SYNTHETIC_POLICY_ID.
        // scenarioId is the 3rd positional arg; it defaults to "base" (the
        // solver tab) but the presentations pre-solve passes a live scenario id
        // for scenario-override decks. The synthetic mixes stay in the 4th slot.
        const mcPayload = await loadMonteCarloData(clientId, access.firmId, assumptions.scenarioRef, [
          { accountId: SYNTHETIC_POLICY_ID, mix: proceeds.mix },
        ]);
        // `coverEstateTaxes` is handled at the route level — the addend is computed
        // (below) and folded into `mcPayload.requiredMinimumAssetLevel`; the engine
        // solver does not see `coverEstateTaxes` itself.
        const solveAssumptions: LifeInsuranceAssumptions & { mcTargetScore: number } = {
          deathYear: assumptions.deathYear,
          proceedsGrowthRate: proceeds.rate,
          proceedsRealization: proceeds.realization,
          leaveToHeirsAmount: assumptions.leaveToHeirsAmount,
          livingExpenseAtDeath: assumptions.livingExpenseAtDeath,
          payoffLiabilityIds: assumptions.payoffLiabilityIds,
          mcTargetScore: assumptions.mcTargetScore,
        };

        // Use hasSpouse (filing status AND spouseDob), not filing status alone:
        // a married plan with no spouseDob cannot build the spouse-death case
        // and would throw inside buildLifeInsuranceWhatIfData (F8).
        const isMarried = hasSpouse(effectiveTree);

        // Per-decedent estate-tax addend (0 when the toggle is off).
        const clientAddend = assumptions.coverEstateTaxes
          ? computeEstateTaxAddend(effectiveTree, "client", solveAssumptions)
          : 0;

        const spouseAddend =
          assumptions.coverEstateTaxes && isMarried
            ? computeEstateTaxAddend(effectiveTree, "spouse", solveAssumptions)
            : 0;

        // The survivor must end with at least the leave-to-heirs target plus
        // the estate-tax addend — the MC solver reads this floor off the
        // payload (see solve-need-mc.ts). Set per case before each solve.
        mcPayload.requiredMinimumAssetLevel =
          assumptions.leaveToHeirsAmount + clientAddend;

        const clientResult = await solveLifeInsuranceNeedMc(
          effectiveTree,
          "client",
          solveAssumptions,
          mcPayload,
          {
            onProgress: (done, total) =>
              emit("progress", { case: "client", done, total }),
            signal: abortController.signal,
          },
        );
        const client = { ...clientResult, estateTaxAddend: clientAddend };

        let spouse: (typeof client) | null = null;
        if (isMarried) {
          mcPayload.requiredMinimumAssetLevel =
            assumptions.leaveToHeirsAmount + spouseAddend;
          const spouseResult = await solveLifeInsuranceNeedMc(
            effectiveTree,
            "spouse",
            solveAssumptions,
            mcPayload,
            {
              onProgress: (done, total) =>
                emit("progress", { case: "spouse", done, total }),
              signal: abortController.signal,
            },
          );
          spouse = { ...spouseResult, estateTaxAddend: spouseAddend };
        }

        emit("result", { isMarried, client, spouse });
      } catch (err) {
        console.error("POST /api/clients/[id]/life-insurance/solve-mc error:", err);
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
