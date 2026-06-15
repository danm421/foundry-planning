// src/domain/copilot/tools/compute.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { CopilotToolContext } from "../context";
import { assertClientReadable } from "../guards";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine";
import type { ProjectionYear } from "@/engine";

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

  return [runProjection];
}
