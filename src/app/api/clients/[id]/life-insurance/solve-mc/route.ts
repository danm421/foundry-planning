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

// Envelope: live solver posts `source` + `mutations` so the MC need solve runs
// against the edited plan. The MC payload (returns / liquid set) stays
// source-based, matching /solver/life-insurance-summary + getOrComputeLifeInsuranceSolve;
// the working tree drives the projection. Supersedes the legacy scenarioRef.
const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]).default("base"),
  mutations: z.array(SOLVER_MUTATION_SCHEMA).default([]),
  assumptions: LI_ASSUMPTIONS_SCHEMA,
});

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

  const parsed = BODY.safeParse(await req.json());
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid body", details: parsed.error.flatten() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const { source, mutations, assumptions } = parsed.data;

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort());

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
        // Working tree = source + live mutations, so the MC need solve reflects
        // the scenario the advisor is editing (matches /solver/project).
        let workingTree = applyMutations(effectiveTree, mutations as SolverMutation[]);
        if (resolutionContext) {
          workingTree = resolveTechniqueMutations(
            workingTree,
            mutations as SolverMutation[],
            resolutionContext,
          );
        }

        // Inject the synthetic policy's model-portfolio mix so the §101
        // proceeds randomize through Monte Carlo. The transformed payout
        // account keeps id === SYNTHETIC_POLICY_ID. The MC payload stays
        // `source`-based (returns / liquid set / startingLiquidBalance), matching
        // getOrComputeLifeInsuranceSolve + the /solver/life-insurance-summary
        // route; the working tree drives the projection via solveLifeInsuranceNeedMc.
        const mcPayload = await loadMonteCarloData(clientId, access.firmId, source, [
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
        const isMarried = hasSpouse(workingTree);

        // Per-decedent estate-tax addend (0 when the toggle is off).
        const clientAddend = assumptions.coverEstateTaxes
          ? computeEstateTaxAddend(workingTree, "client", solveAssumptions)
          : 0;

        const spouseAddend =
          assumptions.coverEstateTaxes && isMarried
            ? computeEstateTaxAddend(workingTree, "spouse", solveAssumptions)
            : 0;

        // The survivor must end with at least the leave-to-heirs target plus
        // the estate-tax addend — the MC solver reads this floor off the
        // payload (see solve-need-mc.ts). Set per case before each solve.
        mcPayload.requiredMinimumAssetLevel =
          assumptions.leaveToHeirsAmount + clientAddend;

        const clientResult = await solveLifeInsuranceNeedMc(
          workingTree,
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
            workingTree,
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
