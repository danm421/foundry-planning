import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadPanelData } from "@/lib/scenario/load-panel-data";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import {
  refFromString,
  type EstateCompareRef,
} from "@/lib/scenario/scenario-from-search-params";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { runProjectionWithEvents, summarizeMonteCarlo } from "@/engine";
import type { ProjectionResult } from "@/engine";
import { compactYear } from "@/lib/projection/compact-year";
import { defineTool, type McpTool } from "../define-tool";

const clientIdArg = z.string().describe("Household id from search_clients.");
const scenarioArg = z.string().optional().describe("Scenario id, or omit for the base case.");

/** Tax figures are only bracket-grounded when bracket mode is on AND year rows loaded. */
function isTaxGrounded(tree: { planSettings?: { taxEngineMode?: string }; taxYearRows?: unknown[] }): boolean {
  return tree.planSettings?.taxEngineMode === "bracket" && (tree.taxYearRows?.length ?? 0) > 0;
}

/**
 * C1 (R47): `loadProjectionForRef` takes a structured `EstateCompareRef`, not
 * a bare string — a bare string has no `.kind`/`.id` and silently falls into
 * `loadEffectiveTreeForRef` with `ref.id === undefined`. Convert the model's
 * plain token through the already-exported `refFromString` (never hand-roll
 * the `snap:`/`base` parsing — that's its job and duplicating it is this
 * repo's known drift hazard); `refFromString` doesn't cover `do-nothing`
 * because that sentinel is estate-planning-only, so it's handled here.
 */
function refFromToken(token: string, which: "left" | "right"): EstateCompareRef {
  return token === "do-nothing" ? { kind: "do-nothing" } : refFromString(token, {}, which);
}

const listScenarios = defineTool({
  name: "list_scenarios",
  title: "List scenarios",
  description:
    "List the scenarios modeled for a household (id, name, and which is the base case). Pass a " +
    "scenarioId to also get that scenario's individual changes and toggle groups. Use this before " +
    "answering 'what have we already modeled'. The base case has no change detail by definition.",
  inputSchema: z.object({ clientId: clientIdArg, scenarioId: scenarioArg }),
  page: "scenarios",
  handler: async ({ clientId, scenarioId }, { firmId }) => {
    const list = await db
      .select({ id: scenarios.id, name: scenarios.name, isBaseCase: scenarios.isBaseCase })
      .from(scenarios)
      .where(eq(scenarios.clientId, clientId));

    if (!scenarioId) return { scenarios: list };
    if (!list.some((s) => s.id === scenarioId)) {
      return { scenarios: list, detail: null, note: `scenario ${scenarioId} is not in this household's roster` };
    }
    const panel = await loadPanelData(clientId, scenarioId, firmId);
    if (panel == null) {
      return { scenarios: list, detail: null, note: `scenario ${scenarioId} has no change detail (base case or unavailable)` };
    }
    return {
      scenarios: list,
      detail: { scenarioId: panel.scenarioId, scenarioName: panel.scenarioName, changes: panel.changes, toggleGroups: panel.toggleGroups },
    };
  },
});

const compareScenarios = defineTool({
  name: "compare_scenarios",
  title: "Compare two scenarios",
  description:
    "Compare two scenarios side by side on lifetime tax and ending portfolio. Each side is a ref " +
    "token: 'base', a scenario id, 'snap:<id>' for a frozen snapshot, or 'do-nothing'. Use this to " +
    "answer 'what does this change cost them'.",
  inputSchema: z.object({
    clientId: clientIdArg,
    left: z.string().describe("Left ref: base | <scenarioId> | snap:<id> | do-nothing"),
    right: z.string().describe("Right ref: base | <scenarioId> | snap:<id> | do-nothing"),
  }),
  page: "scenarios",
  handler: async ({ clientId, left, right }, { firmId }) => {
    const [l, r] = await Promise.all([
      loadProjectionForRef(clientId, firmId, refFromToken(left, "left")),
      loadProjectionForRef(clientId, firmId, refFromToken(right, "right")),
    ]);
    const lifetimeTax = (res: ProjectionResult) =>
      res.years.reduce((s, y) => s + (y.taxResult?.flow.totalTax ?? 0), 0);
    // C2 (R48): portfolioAssets is an object (per-account maps + totals), not
    // a scalar — `.total` is the household's single reconciling figure.
    const endingPortfolio = (res: ProjectionResult) => res.years.at(-1)?.portfolioAssets.total ?? 0;
    return {
      left: { ref: left, scenarioName: l.scenarioName, lifetimeTax: lifetimeTax(l.result), endingPortfolio: endingPortfolio(l.result) },
      right: { ref: right, scenarioName: r.scenarioName, lifetimeTax: lifetimeTax(r.result), endingPortfolio: endingPortfolio(r.result) },
    };
  },
});

const runProjection = defineTool({
  name: "run_projection",
  title: "Run the cash-flow projection",
  description:
    "Run Foundry's deterministic year-by-year projection and return the per-year story: total " +
    "income, total expenses, net cash flow, total tax, Medicare and IRMAA, and portfolio assets, " +
    "plus the first and second death years. If taxGrounded is false the tax figures came from " +
    "flat-rate fallback — do not present them as bracket-accurate. All numbers are the engine's " +
    "own: narrate them, never recompute.",
  inputSchema: z.object({ clientId: clientIdArg, scenarioId: scenarioArg }),
  page: "cashflow",
  handler: async ({ clientId, scenarioId }, { firmId }) => {
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenarioId ?? "base", {});
    const result = runProjectionWithEvents(effectiveTree);
    return {
      scenarioId: scenarioId ?? "base",
      taxGrounded: isTaxGrounded(effectiveTree),
      firstDeathYear: result.firstDeathEvent?.year ?? null,
      secondDeathYear: result.secondDeathEvent?.year ?? null,
      // C3 (R49): `compactYear` passes `portfolioAssets` through whole — eight
      // account-UUID-keyed maps plus ~12 totals. compactYear itself is shared
      // with Forge and frozen (R2h); reduce to the scalar total AFTER it, on
      // this MCP path only, so ~35 years of raw account identifiers never
      // reach the model.
      years: result.years.map((y) => ({ ...compactYear(y), portfolioAssets: y.portfolioAssets.total })),
    };
  },
});

const getTaxProjection = defineTool({
  name: "get_tax_projection",
  title: "Tax projection by year",
  description:
    "Per-year federal and state tax detail for a household: taxable income by character, total " +
    "tax, and Medicare IRMAA surcharges. When taxGrounded is false these came from flat-rate " +
    "fallback rather than real brackets — say so. Use run_projection for the whole cash-flow " +
    "picture; use this when the question is specifically about taxes.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
    startYear: z.number().int().optional().describe("First year to include."),
    endYear: z.number().int().optional().describe("Last year to include."),
  }),
  page: "tax",
  handler: async ({ clientId, scenarioId, startYear, endYear }, { firmId }) => {
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenarioId ?? "base", {});
    const result = runProjectionWithEvents(effectiveTree);
    const years = result.years
      .filter((y) => (startYear == null || y.year >= startYear) && (endYear == null || y.year <= endYear))
      .map((y) => ({
        year: y.year,
        ages: y.ages,
        totalTax: y.taxResult?.flow.totalTax ?? null,
        taxDetail: y.taxDetail ?? null,
        medicare: y.medicare
          ? { totalAnnualCost: y.medicare.totalAnnualCost, totalIrmaaSurcharge: y.medicare.totalIrmaaSurcharge }
          : null,
      }));
    return { scenarioId: scenarioId ?? "base", taxGrounded: isTaxGrounded(effectiveTree), years };
  },
});

const getMonteCarlo = defineTool({
  name: "get_monte_carlo",
  title: "Probability of success",
  description:
    "Foundry's Monte Carlo result for a household: the probability of success (successRate), the " +
    "failure rate, ending-balance percentiles, and per-year balance bands. Served from cache; set " +
    "refresh true only when the plan changed since the last run, because a full run is slow. " +
    "successRate is a fraction between 0 and 1.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
    refresh: z.boolean().optional().describe("Force a recompute instead of using the cache."),
  }),
  page: "monteCarlo",
  handler: async ({ clientId, scenarioId, refresh }, { firmId }) => {
    const scenario = scenarioId ?? "base";
    const [cached, { effectiveTree }] = await Promise.all([
      getOrComputeMonteCarlo({ clientId, firmId, scenarioId: scenario, forceRefresh: refresh ?? false }),
      loadEffectiveTree(clientId, firmId, scenario, {}),
    ]);
    const summary = summarizeMonteCarlo(cached.raw, {
      client: effectiveTree.client,
      planSettings: effectiveTree.planSettings,
      startingLiquidBalance: cached.meta.startingLiquidBalance,
    });
    return {
      scenarioId: scenario,
      successRate: summary.successRate,
      failureRate: summary.failureRate,
      requestedTrials: summary.requestedTrials,
      trialsRun: summary.trialsRun,
      ending: summary.ending,
      byYear: summary.byYear,
    };
  },
});

const getEstateSummary = defineTool({
  name: "get_estate_summary",
  title: "Estate summary",
  description:
    "The household's estate picture: the full estate-tax computation at the first and second " +
    "death — deductions, applicable exclusion, and total tax, down to a per-account gross-estate " +
    "line list — the hypothetical estate tax if both died today, the year-by-year gift ledger, " +
    "the trusts and business entities on the plan, and any wills (bequests and residuary " +
    "recipients). Use this for estate-tax exposure and gifting questions.",
  inputSchema: z.object({ clientId: clientIdArg, scenarioId: scenarioArg }),
  page: "estate",
  handler: async ({ clientId, scenarioId }, { firmId }) => {
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenarioId ?? "base", {});
    const result = runProjectionWithEvents(effectiveTree);
    return {
      scenarioId: scenarioId ?? "base",
      firstDeath: result.firstDeathEvent ?? null,
      secondDeath: result.secondDeathEvent ?? null,
      todayHypotheticalEstateTax: result.todayHypotheticalEstateTax,
      giftLedger: result.giftLedger,
      entities: effectiveTree.entities ?? [],
      wills: effectiveTree.wills ?? [],
    };
  },
});

export const planTools: McpTool[] = [
  listScenarios,
  compareScenarios,
  runProjection,
  getTaxProjection,
  getMonteCarlo,
  getEstateSummary,
];
