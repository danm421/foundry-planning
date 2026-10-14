// src/domain/mcp/tools/projection-data.ts
//
// The engine's year-by-year figures, for decks and charts Claude builds
// itself. A saved scenario, or a saved scenario plus unsaved what-if changes.
// Nothing is saved.
import { z } from "zod";
import { runProjectionWithEvents, summarizeMonteCarlo, type ProjectionResult } from "@/engine";
import type { ClientData } from "@/engine/types";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { estateHeirTotalsEol } from "@/lib/solver/solver-summary-metrics";
import { MAX_CHANGES } from "@/lib/whatif/caps";
import { WHAT_IF_CHANGE_SCHEMA } from "@/lib/whatif/changes";
import { WhatIfValidationError } from "@/lib/whatif/errors";
import { heirOwnerNames } from "@/lib/whatif/metrics";
import { applyWhatIf } from "@/lib/whatif/run";
import { growthDefaultsFrom, translateChanges } from "@/lib/whatif/translate";
import { defineTool, type McpTool } from "../define-tool";
import { buildRunDeps, chargeCompute } from "../whatif-jobs";

export const PROJECTION_SECTIONS = ["cashflow", "balances", "tax", "estate", "monte_carlo"] as const;
type Section = (typeof PROJECTION_SECTIONS)[number];

/** Well under Vercel's 4.5 MB response limit, leaving room for the JSON-RPC envelope. */
export const MAX_RESPONSE_CHARS = 1_500_000;

export function assertWithinSize(result: unknown): void {
  if (JSON.stringify(result).length > MAX_RESPONSE_CHARS) {
    throw new WhatIfValidationError(
      "That's more data than one call can return. Ask for fewer sections or a shorter year range.",
    );
  }
}

const inRange = (year: number, r: { startYear?: number; endYear?: number }) =>
  (r.startYear === undefined || year >= r.startYear) && (r.endYear === undefined || year <= r.endYear);

export function buildSections(
  tree: ClientData,
  projection: ProjectionResult,
  sections: readonly Section[],
  range: { startYear?: number; endYear?: number },
): Record<string, unknown> {
  const years = projection.years.filter((y) => inRange(y.year, range));
  const out: Record<string, unknown> = {};

  if (sections.includes("cashflow")) {
    out.cashflow = years.map((y) => ({
      year: y.year,
      ages: y.ages,
      totalIncome: y.income.total,
      salaries: y.income.salaries,
      socialSecurity: y.income.socialSecurity,
      totalExpenses: y.expenses.total,
      livingExpenses: y.expenses.living,
      taxes: y.expenses.taxes,
      savings: y.savings.total,
      withdrawals: y.withdrawals.total,
      netCashFlow: y.netCashFlow,
    }));
  }

  if (sections.includes("balances")) {
    const accounts = tree.accounts.map((a) => ({ id: a.id, name: a.name, category: a.category }));
    out.balances = {
      accounts,
      years: years.map((y) => ({
        year: y.year,
        liquidPortfolio: y.portfolioAssets.liquidTotal,
        endingValues: accounts.map((a) => Math.round(y.accountLedgers[a.id]?.endingValue ?? 0)),
      })),
    };
  }

  if (sections.includes("tax")) {
    out.tax = years.map((y) => ({
      year: y.year,
      totalTax: y.taxResult?.flow.totalTax ?? null,
      federalTax: y.taxResult?.flow.totalFederalTax ?? null,
      stateTax: y.taxResult?.flow.stateTax ?? null,
      irmaaSurcharge: y.medicare?.totalIrmaaSurcharge ?? null,
      rothConverted: (y.rothConversions ?? []).reduce((sum, c) => sum + c.gross, 0),
    }));
  }

  if (sections.includes("estate")) {
    const heirs = estateHeirTotalsEol(projection, tree, heirOwnerNames(tree));
    out.estate = {
      firstDeathYear: projection.firstDeathEvent?.year ?? null,
      secondDeathYear: projection.secondDeathEvent?.year ?? null,
      netToHeirs: heirs?.netToHeirs ?? null,
      heirIncomeTax: heirs?.heirIncomeTax ?? null,
    };
  }

  return out;
}

const getProjectionData = defineTool({
  name: "get_projection_data",
  title: "Get projection data",
  description:
    "Year-by-year figures from Foundry's engine, for charts and decks you build yourself. Choose sections: cashflow " +
    "(income, expenses, taxes, savings, withdrawals, net cash flow), balances (each account's year-end value — the " +
    "account list comes once, then each year's values in that order — plus the liquid portfolio), tax (federal, " +
    "state, IRMAA, Roth converted), estate (death years and net to heirs, already net of heirs' income tax on " +
    "inherited IRAs), monte_carlo (success rate and yearly bands; saved scenarios only). Pass changes, in the same " +
    "shape try_what_if takes, to chart an unsaved what-if; nothing is saved. Narrow with startYear and endYear when " +
    "you don't need every year. For a standard Foundry page's exact numbers, use get_report_page_data instead.",
  inputSchema: z.object({
    clientId: z
      .string()
      .describe("Planning client id from search_clients (the clientId field, present only when hasPlan is true). NOT a CRM household id."),
    scenarioId: z.string().optional().describe("Starting scenario id from list_scenarios, or omit for the base case."),
    changes: z.array(WHAT_IF_CHANGE_SCHEMA).max(MAX_CHANGES).optional(),
    sections: z.array(z.enum(PROJECTION_SECTIONS)).min(1),
    startYear: z.number().int().optional(),
    endYear: z.number().int().optional(),
  }),
  page: "cashflow",
  handler: async ({ clientId, scenarioId, changes, sections, startYear, endYear }, { principal, firmId }) => {
    const scenario = scenarioId ?? "base";
    const hasChanges = (changes?.length ?? 0) > 0;
    if (hasChanges && sections.includes("monte_carlo")) {
      throw new WhatIfValidationError(
        "monte_carlo is only available for a saved scenario. For an unsaved what-if, use try_what_if with includeMonteCarlo.",
      );
    }
    const deps = await buildRunDeps(clientId, firmId, scenario);
    let tree = deps.tree;
    if (hasChanges) {
      const { mutations } = translateChanges(tree, changes!, undefined, {
        growthDefaults: growthDefaultsFrom(deps.resolutionContext),
      });
      await chargeCompute(principal, 1);
      tree = applyWhatIf(tree, mutations, deps.resolutionContext);
    }
    const projection = runProjectionWithEvents(tree);
    const result: Record<string, unknown> = {
      scenarioId: scenario,
      changesApplied: changes?.length ?? 0,
      ...buildSections(tree, projection, sections, { startYear, endYear }),
    };
    if (sections.includes("monte_carlo")) {
      const cached = await getOrComputeMonteCarlo({ clientId, firmId, scenarioId: scenario, forceRefresh: false });
      const summary = summarizeMonteCarlo(cached.raw, {
        client: tree.client,
        planSettings: tree.planSettings,
        startingLiquidBalance: cached.meta.startingLiquidBalance,
      });
      result.monteCarlo = {
        successRate: summary.successRate,
        byYear: summary.byYear.filter((r: { year: number }) => inRange(r.year, { startYear, endYear })),
      };
    }
    assertWithinSize(result);
    return result;
  },
});

export const projectionDataTools: McpTool[] = [getProjectionData];
