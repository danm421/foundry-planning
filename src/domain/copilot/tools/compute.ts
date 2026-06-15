// src/domain/copilot/tools/compute.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { CopilotToolContext } from "../context";
import { assertClientReadable } from "../guards";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine";
import type { ProjectionYear } from "@/engine";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { summarizeMonteCarlo } from "@/engine/monteCarlo/summarize";

/** Per-year story compacted for the model — the engine's own numbers only. */
function compactYear(y: ProjectionYear) {
  return {
    year: y.year,
    ages: y.ages,
    totalIncome: y.income.total,
    totalExpenses: y.expenses.total,
    netCashFlow: y.netCashFlow,
    totalTax: y.taxResult?.totalTax ?? null,
    medicareTotal: y.medicare?.totalAnnualCost ?? null,
    irmaaSurcharge: y.medicare?.totalIrmaaSurcharge ?? null,
    portfolioAssets: y.portfolioAssets,
  };
}

export function buildComputeTools(toolCtx: CopilotToolContext) {
  const { ctx } = toolCtx;

  const runProjection = tool(
    async ({ clientId }) => {
      const firmId = await requireOrgId();
      await assertClientReadable(ctx, clientId);

      // ALWAYS resolve the tree through loadEffectiveTree — hand-building
      // ClientData skips numeric coercion and yields NaN.
      const { effectiveTree } = await loadEffectiveTree(
        clientId,
        firmId,
        ctx.scenarioId,
        {},
      );
      const result = runProjectionWithEvents(effectiveTree);

      // Tax numbers are only bracket-grounded when bracket mode is on AND the
      // year rows actually loaded; otherwise the engine ran flat-mode fallback.
      const taxGrounded =
        effectiveTree.planSettings.taxEngineMode === "bracket" &&
        (effectiveTree.taxYearRows?.length ?? 0) > 0;

      return JSON.stringify({
        scenarioId: ctx.scenarioId,
        taxGrounded,
        firstDeathYear: result.firstDeathEvent?.year ?? null,
        secondDeathYear: result.secondDeathEvent?.year ?? null,
        years: result.years.map(compactYear),
      });
    },
    {
      name: "run_projection",
      description:
        "Run the deterministic cash-flow projection for the ACTIVE scenario and return the " +
        "per-year story: income, expenses, net cash flow, total tax, Medicare/IRMAA, and " +
        "portfolio assets, plus first/second death years. If taxGrounded is false the tax " +
        "figures came from flat-mode fallback — do not present them as bracket-accurate. " +
        "All numbers are the engine's own; narrate them, never recompute.",
      schema: z.object({
        clientId: z.string().describe("the active client uuid"),
      }),
    },
  );

  const runMonteCarlo = tool(
    async ({ clientId }) => {
      const firmId = await requireOrgId();
      await assertClientReadable(ctx, clientId);

      // Tree is needed for the summarize options (client + planSettings); the
      // cache helper resolves its own tree internally too, but reusing the
      // persisted per-scenario seed makes the PoS reproducible across turns.
      const { effectiveTree } = await loadEffectiveTree(
        clientId,
        firmId,
        ctx.scenarioId,
        {},
      );

      // Long-running + cache-backed. Handle null/throw by degrading — never
      // assert, never invent a probability.
      let cached: Awaited<ReturnType<typeof getOrComputeMonteCarlo>> | null = null;
      try {
        cached = await getOrComputeMonteCarlo({
          clientId,
          firmId,
          scenarioId: ctx.scenarioId,
        });
      } catch (err) {
        console.error("[copilot] monte-carlo compute failed", err);
      }
      if (!cached || cached.raw.trialsRun === 0) {
        return JSON.stringify({
          available: false,
          note: "Monte Carlo could not be computed for this scenario right now.",
        });
      }

      const summary = summarizeMonteCarlo(cached.raw, {
        client: effectiveTree.client,
        planSettings: effectiveTree.planSettings,
        startingLiquidBalance: cached.meta.startingLiquidBalance,
      });

      return JSON.stringify({
        available: true,
        scenarioId: ctx.scenarioId,
        requestedTrials: summary.requestedTrials,
        trialsRun: summary.trialsRun,
        aborted: summary.aborted,
        successRate: summary.successRate,
        failureRate: summary.failureRate,
        endingDistribution: summary.ending,
      });
    },
    {
      name: "run_monte_carlo",
      description:
        "Run the canonical 1000-trial Monte Carlo simulation for the ACTIVE scenario and " +
        "return the probability of success (successRate), failure rate, and the terminal " +
        "(ending) wealth distribution percentiles. Uses the persisted per-scenario seed for " +
        "reproducibility. If available is false the sim could not run — say so, do not state a " +
        "probability. Report successRate as the official PoS; never recompute it.",
      schema: z.object({
        clientId: z.string().describe("the active client uuid"),
      }),
    },
  );

  return [runProjection, runMonteCarlo];
}
