// src/app/api/clients/[id]/analysis/retirement/options/route.ts
//
// POST — SSE. Solves the 3 deterministic full-funding columns
// (Minimum Additional Savings, Maximum Retirement Spending, Earliest
// Retirement Age) and streams one `column` event per converged column,
// then a terminal `done` event. Read-only on the DB.
import { NextRequest } from "next/server";
import { z } from "zod";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { solveFunding } from "@/lib/solver/solve-funding";
import { deriveRetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import type { SolverMutation } from "@/lib/solver/types";
import type { SolveLeverKey } from "@/lib/solver/solve-types";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  buildHypotheticalSavings,
  SYNTHETIC_SAVINGS_ACCOUNT_ID,
  type GrowthResolverLike,
  type MinSavingsGrowth,
} from "@/lib/analysis/hypothetical-savings";
import { earliestRetirementYear } from "@/lib/analysis/retirement-window";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";

export const dynamic = "force-dynamic";

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
  /** Growth assumption for the hypothetical taxable savings. Defaults to the
   *  client's taxable category default when omitted. */
  minSavingsGrowth: z
    .union([
      z.object({ kind: z.literal("taxable-default") }),
      z.object({ kind: z.literal("model-portfolio"), portfolioId: z.string().uuid() }),
      z.object({ kind: z.literal("custom-rate"), rate: z.number().min(-1).max(2) }),
    ])
    .optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };
type EventName = "column" | "done" | "error";

function sseChunk(event: EventName, payload: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** Human-readable growth assumption for the funding-source sub-line. The UI
 *  renders this verbatim after "growing at". */
function formatGrowthLabel(growth: MinSavingsGrowth, rate: number): string {
  const pct = `${(rate * 100).toFixed(1)}%`;
  switch (growth.kind) {
    case "custom-rate":
      return `Custom ${pct}`;
    case "model-portfolio":
      return `Model portfolio · ${pct}`;
    case "taxable-default":
      return `Taxable default ${pct}`;
  }
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

  const parsed = BODY.safeParse(await req.json());
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid body", details: parsed.error.flatten() }),
      { status: 400, headers: { "content-type": "application/json" } },
    );
  }
  const { source, mutations, minSavingsGrowth } = parsed.data;

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  req.signal.addEventListener("abort", () => abortController.abort());

  const columns: { id: string; target: SolveLeverKey }[] = [
    {
      id: "min-savings",
      target: { kind: "savings-contribution", accountId: SYNTHETIC_SAVINGS_ACCOUNT_ID },
    },
    { id: "max-spending", target: { kind: "living-expense-scale" } },
    { id: "earliest-retirement", target: { kind: "retirement-age", person: "client" } },
  ];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: EventName, payload: unknown) =>
        controller.enqueue(encoder.encode(sseChunk(event, payload)));
      try {
        const { effectiveTree, resolutionContext } = await loadEffectiveTree(
          clientId,
          firmId,
          source,
          {},
        );

        // Inject a synthetic, analysis-only taxable account + self-funding rule
        // that the "Minimum Additional Savings" column solves against. Inert for
        // the other two columns: their levers never raise its annualAmount above
        // 0, so the engine's funding waterfall skips it.
        const growth: MinSavingsGrowth = minSavingsGrowth ?? { kind: "taxable-default" };
        const resolver: GrowthResolverLike = resolutionContext?.resolver ?? {
          resolveCategoryDefault: () => ({ rate: 0.05 }),
          resolvePortfolio: () => ({ geoReturn: 0.05, pctOi: 0, pctLtcg: 0, pctQdiv: 0, pctTaxEx: 0 }),
        };
        const ownerFamilyMemberId =
          effectiveTree.familyMembers?.find((m) => m.role === "client")?.id ?? LEGACY_FM_CLIENT;
        const { account: synthAccount, rule: synthRule } = buildHypotheticalSavings(growth, resolver, {
          startYear: effectiveTree.planSettings.planStartYear,
          endYear: earliestRetirementYear(effectiveTree.client),
          ownerFamilyMemberId,
        });
        effectiveTree.accounts = [...effectiveTree.accounts, synthAccount];
        effectiveTree.savingsRules = [...effectiveTree.savingsRules, synthRule];
        const growthLabel = formatGrowthLabel(growth, synthAccount.growthRate);

        for (const col of columns) {
          if (abortController.signal.aborted) break;
          const result = await solveFunding({
            effectiveTree,
            baselineMutations: mutations as SolverMutation[],
            target: col.target,
            resolutionContext,
            signal: abortController.signal,
          });
          const isMinSavings = col.id === "min-savings";
          const maxExpenseReduction = isMinSavings
            ? result.finalProjection.reduce(
                (m, y) => Math.max(m, y.hypotheticalSavings?.fromExpenseReduction ?? 0),
                0,
              )
            : 0;
          emit("column", {
            column: col.id,
            status: result.status,
            solvedValue: result.solvedValue,
            summary: deriveRetirementSummary(result.finalProjection),
            ...(isMinSavings
              ? {
                  fundingSource: {
                    maxExpenseReduction,
                    growthRate: synthAccount.growthRate,
                    growthLabel,
                  },
                }
              : {}),
          });
        }
        emit("done", {});
      } catch (err) {
        console.error("POST /analysis/retirement/options error:", err);
        emit("error", { message: "Internal server error" });
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
