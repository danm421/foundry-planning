// src/domain/forge/tools/compute.ts
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { ForgeToolContext } from "../context";
import { assertClientReadable } from "../guards";
import { requireOrgId } from "@/lib/db-helpers";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine";
import type { ProjectionYear } from "@/engine";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { summarizeMonteCarlo } from "@/engine/monteCarlo/summarize";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import type { EstateCompareRef } from "@/lib/scenario/scenario-from-search-params";
import type { ProjectionResult } from "@/engine";
import {
  PRESENTATION_PAGES,
  type BuildDataContext,
  type PresentationPageId,
} from "@/components/presentations/registry";
import { resolveAccentColor } from "@/components/pdf/theme";

/** Map a model-supplied token to an EstateCompareRef. Mirrors tokenToRef in
 *  scenario-from-search-params.ts: "do-nothing" → counterfactual, "base" →
 *  base case, "snap:<id>" → snapshot, otherwise a scenario uuid. */
function refFromToken(token: string): EstateCompareRef {
  if (token === "do-nothing") return { kind: "do-nothing" };
  if (token === "base") return { kind: "scenario", id: "base", toggleState: {} };
  if (token.startsWith("snap:")) {
    return { kind: "snapshot", id: token.slice("snap:".length), side: "left" };
  }
  return { kind: "scenario", id: token, toggleState: {} };
}

function lifetimeTax(result: ProjectionResult): number {
  return result.years.reduce((sum, y) => sum + (y.taxResult?.flow.totalTax ?? 0), 0);
}
function endingPortfolio(result: ProjectionResult): number {
  const last = result.years[result.years.length - 1];
  // `?? 0` is effectively unreachable: a valid plan always spans
  // planStartYear..planEndYear, so `years` is never empty. The fallback exists
  // only to satisfy the optional-access type — it is not a real "$0 portfolio".
  return last?.portfolioAssets.total ?? 0;
}

// Pages whose buildData depends on an optional context bundle that explain_report
// does NOT load (investments / monteCarlo / lifeInsurance / scenarioChanges /
// bundlesByRef). Built without it they return structurally-empty data the model
// could narrate as a real zero. Surface them as unavailable + redirect to the
// dedicated tool instead of building ungrounded output.
const PAGES_NEEDING_UNLOADED_CONTEXT = new Set<string>([
  "assetAllocation",      // needs ctx.investments
  "portfolioAnalysis",    // needs ctx.investments
  "monteCarlo",           // needs ctx.monteCarlo — use run_monte_carlo
  "lifeInsuranceSummary", // needs ctx.lifeInsurance
  "scenarioChanges",      // needs ctx.scenarioChanges — use list_scenarios
  "retirementComparison", // needs bundlesByRef — use compare_scenarios
]);

/** Per-year story compacted for the model — the engine's own numbers only. */
function compactYear(y: ProjectionYear) {
  return {
    year: y.year,
    ages: y.ages,
    totalIncome: y.income.total,
    totalExpenses: y.expenses.total,
    netCashFlow: y.netCashFlow,
    totalTax: y.taxResult?.flow.totalTax ?? null,
    medicareTotal: y.medicare?.totalAnnualCost ?? null,
    irmaaSurcharge: y.medicare?.totalIrmaaSurcharge ?? null,
    portfolioAssets: y.portfolioAssets,
  };
}

export function buildComputeTools(
  toolCtx: ForgeToolContext,
): StructuredToolInterface[] {
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
        console.error("[forge] monte-carlo compute failed", err);
      }
      // The compute cache returns `row.payload as T` with no shape validation, so
      // a stale/partial cached result could be missing `raw` entirely. Degrade
      // (don't deref `cached.raw.trialsRun` and throw an uncaught TypeError).
      if (!cached?.raw || cached.raw.trialsRun === 0) {
        return JSON.stringify({
          available: false,
          note: "Monte Carlo could not be computed for this scenario right now.",
        });
      }

      const summary = summarizeMonteCarlo(cached.raw, {
        client: effectiveTree.client,
        planSettings: effectiveTree.planSettings,
        startingLiquidBalance: cached.meta?.startingLiquidBalance,
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

  const compareScenarios = tool(
    async ({ clientId, left, right }) => {
      const firmId = await requireOrgId();
      await assertClientReadable(ctx, clientId);

      const [a, b] = await Promise.all([
        loadProjectionForRef(clientId, firmId, refFromToken(left)),
        loadProjectionForRef(clientId, firmId, refFromToken(right)),
      ]);

      const aEnd = endingPortfolio(a.result);
      const bEnd = endingPortfolio(b.result);
      const aTax = lifetimeTax(a.result);
      const bTax = lifetimeTax(b.result);

      return JSON.stringify({
        left: { scenarioName: a.scenarioName, endingPortfolio: aEnd, lifetimeTax: aTax },
        right: { scenarioName: b.scenarioName, endingPortfolio: bEnd, lifetimeTax: bTax },
        // Combined left→right delta only. Do NOT attribute to a single change.
        delta: { endingPortfolio: bEnd - aEnd, lifetimeTax: bTax - aTax },
      });
    },
    {
      name: "compare_scenarios",
      description:
        "Compare two plans side by side and return end-of-plan portfolio assets and total " +
        "lifetime tax for each, plus the combined left→right delta. Each side is a token: " +
        "'base', a scenario id, 'snap:<id>' for a snapshot, or 'do-nothing' for the no-plan " +
        "counterfactual. The delta is the combined difference between the two plans — never " +
        "attribute it to one specific change.",
      schema: z.object({
        clientId: z.string().describe("the active client uuid"),
        left: z.string().describe("left ref token: base | <scenarioId> | snap:<id> | do-nothing"),
        right: z.string().describe("right ref token: base | <scenarioId> | snap:<id> | do-nothing"),
      }),
    },
  );

  const explainReport = tool(
    async ({ clientId, pageId }) => {
      const firmId = await requireOrgId();
      await assertClientReadable(ctx, clientId);

      // Enumerate pages at RUNTIME — never hardcode the list.
      const ids = Object.keys(PRESENTATION_PAGES) as PresentationPageId[];
      if (!pageId) {
        return JSON.stringify({
          availablePages: ids.map((id) => ({
            id,
            title: PRESENTATION_PAGES[id].title,
            description: PRESENTATION_PAGES[id].description,
            category: PRESENTATION_PAGES[id].category,
            supportsScenarioOverride: PRESENTATION_PAGES[id].supportsScenarioOverride,
          })),
        });
      }
      // `Object.hasOwn` (not `in`) so prototype keys like "constructor"/"toString"
      // don't pass as real page ids and then crash on `.buildData`.
      if (!Object.hasOwn(PRESENTATION_PAGES, pageId)) {
        return JSON.stringify({
          error: `Unknown page "${pageId}".`,
          availablePages: ids.map((id) => ({ id, title: PRESENTATION_PAGES[id].title })),
        });
      }

      const page = PRESENTATION_PAGES[pageId as PresentationPageId];
      // Pages that need a context bundle this tool doesn't load would build
      // structurally-empty data the model could narrate as a real zero. Surface
      // them as unavailable (and redirect to the dedicated tool) BEFORE loading
      // the tree or calling buildData. `requiredScenarioRefs` marks multi-scenario
      // pages that need bundlesByRef, which this tool also doesn't assemble.
      if (
        PAGES_NEEDING_UNLOADED_CONTEXT.has(pageId) ||
        typeof page.requiredScenarioRefs === "function"
      ) {
        return JSON.stringify({
          pageId,
          unavailable: true,
          reason:
            "This page needs data this tool does not load (investment / Monte Carlo / multi-scenario context).",
          hint: "Use run_monte_carlo, read_detail, compare_scenarios, or list_scenarios for that data.",
        });
      }

      const { effectiveTree } = await loadEffectiveTree(
        clientId,
        firmId,
        ctx.scenarioId,
        {},
      );
      const projection = runProjectionWithEvents(effectiveTree);
      const c = effectiveTree.client;
      const clientName = `${c.firstName} ${c.lastName}`.trim();

      // Assemble the same context shape the export route builds. The forge
      // needs only the page DATA, not PDF branding, so cover/branding fields
      // get safe placeholders (non-framing pages ignore them).
      const reportCtx: BuildDataContext = {
        years: projection.years,
        projection,
        clientData: effectiveTree,
        scenarioLabel: ctx.scenarioId === "base" ? "Base case" : "Scenario",
        clientName,
        spouseName: c.spouseName ?? null,
        firmName: "",
        firmTagline: null,
        reportDate: new Date().toISOString().slice(0, 10),
        firmLogoDataUrl: null,
        // Forge returns page DATA, not a styled PDF — use the default report
        // accent (firm override is irrelevant here; only framing pages read it).
        accentColor: resolveAccentColor(null),
      };

      // `page` is the union of all page defs; `buildData`'s options param is the
      // intersection of every page's option type (contravariant method on a
      // union). `as never` is the same escape hatch the export route uses
      // (see document.tsx) to call buildData with each page's own defaults.
      const data = page.buildData(reportCtx, page.defaultOptions as never);
      // Summary pages emit deterministic `narrative` bullets — surface them so
      // the agent paraphrases a correct baseline rather than inventing prose.
      const narrative =
        data && typeof data === "object" && "narrative" in data
          ? (data as { narrative: unknown }).narrative
          : null;

      return JSON.stringify({
        pageId,
        title: page.title,
        description: page.description,
        category: page.category,
        supportsScenarioOverride: page.supportsScenarioOverride,
        data,
        narrative,
      });
    },
    {
      name: "explain_report",
      description:
        "Get the exact data a presentation page would show for the ACTIVE scenario. Call with " +
        "no pageId to list the available pages ({id, title, category}); call with a pageId to " +
        "get that page's built data and (for summary pages) its deterministic narrative " +
        "bullets. Narrate FROM this data — every number you state about the report must come " +
        "from this payload.",
      schema: z.object({
        clientId: z.string().describe("the active client uuid"),
        pageId: z
          .string()
          .optional()
          .describe("optional: a page id from the list; omit to enumerate available pages"),
      }),
    },
  );

  return [runProjection, runMonteCarlo, compareScenarios, explainReport];
}
