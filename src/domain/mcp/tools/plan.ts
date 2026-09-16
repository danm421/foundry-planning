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
import { describeChangeUnit } from "@/lib/scenario/scenario-change-describe";
import { visibleChangeFields } from "@/lib/scenario/hidden-change-fields";
import type { ScenarioChange } from "@/engine/scenario/types";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { runProjectionWithEvents, summarizeMonteCarlo } from "@/engine";
import type { ProjectionResult, ProjectionYear } from "@/engine";
import type { HypotheticalEstateTaxOrdering } from "@/engine/types";
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

/**
 * F2 (R47 fix-round addendum): `scenario_changes.payload` is an open-ended
 * raw form body — an `add` carries the FULL entity object and an `edit`
 * carries a `{field: {from, to}}` map (`src/engine/scenario/types.ts:50-55`),
 * so a family-member add ships a `dateOfBirth` and a client edit can ship an
 * email, phone or home address. `sanitizeRow` only masks SSNs and account
 * numbers, so none of that is caught downstream — this is R43's hole, one
 * tool over.
 *
 * The shared `describeChangeUnit` is safe for add/remove/group/multi-field
 * edits — all four print only field NAMES and entity NAMES — but its
 * single-field-edit branch prints the VALUE ("Changed dateOfBirth on Jane
 * Smith: 1961-05-04 → 1962-05-04."). The MCP surface may only ever emit
 * field/entity names, never values, so that one case gets its own
 * value-free wording instead of delegating. A sensitive-field allowlist
 * (`["dateOfBirth", "email", ...]`) was considered and rejected: the
 * payload is open-ended, so a field missing from the list leaks silently —
 * the exact R43 trap. "No values, ever" has nothing to drift.
 */
function describeChange(
  c: ScenarioChange & { enabled: boolean },
  targetNames: Record<string, string>,
): string {
  if (c.opType === "edit") {
    const visible = visibleChangeFields(
      c.targetKind,
      (c.payload ?? {}) as Record<string, { from: unknown; to: unknown }>,
    );
    const fields = Object.keys(visible);
    if (fields.length === 1) {
      const name = targetNames[`${c.targetKind}:${c.targetId}`] ?? `${c.targetKind} ${c.targetId.slice(0, 6)}`;
      return `Changed ${fields[0]} on ${name}.`;
    }
  }
  return describeChangeUnit({ kind: "single", change: c }, targetNames);
}

/**
 * F3: `taxDetail.bySource` is a `Record` keyed by raw entity/account/
 * transfer ids (income row ids, `business_passthrough:<id>`,
 * `transfer:<id>`, `roth_conversion:<id>` — `projection.ts:2686, 2904, 3068,
 * 3073`) — the same class of leak C3 fixed for `portfolioAssets`, but
 * unbounded across every plan year with no `startYear`/`endYear` to cap it.
 * Whitelist the scalar buckets; `bySource` never leaves the server.
 */
function compactTaxDetail(
  detail: NonNullable<ProjectionYear["taxDetail"]>,
): Omit<NonNullable<ProjectionYear["taxDetail"]>, "bySource"> {
  return {
    earnedIncome: detail.earnedIncome,
    ficaExemptEarnedIncome: detail.ficaExemptEarnedIncome,
    ordinaryIncome: detail.ordinaryIncome,
    dividends: detail.dividends,
    capitalGains: detail.capitalGains,
    stCapitalGains: detail.stCapitalGains,
    qbi: detail.qbi,
    taxExempt: detail.taxExempt,
    taxExemptInterest: detail.taxExemptInterest,
    capitalLossCarryforward: detail.capitalLossCarryforward,
    capitalLossDeduction: detail.capitalLossDeduction,
    disallowedCapitalLoss: detail.disallowedCapitalLoss,
  };
}

/**
 * F5: a `HypotheticalEstateTaxOrdering` carries up to two FULL
 * `EstateTaxResult`s (`grossEstateLines` etc. — the same class of leak as
 * C3/F3) plus `DeathTransfer[]`, whose `recipientLabel` is a family member's
 * full name and `sourceAccountName` an account name. Reduce to the headline
 * totals the description promises ("the hypothetical estate tax").
 */
function summarizeHypotheticalOrdering(o: HypotheticalEstateTaxOrdering) {
  return { firstDecedent: o.firstDecedent, totals: o.totals };
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
      .where(eq(scenarios.clientId, clientId))
      // Fold-in: unordered Postgres output can hand the model a different
      // roster order per call for the same household.
      .orderBy(scenarios.createdAt);

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
      detail: {
        scenarioId: panel.scenarioId,
        scenarioName: panel.scenarioName,
        // F2: project to field/entity names only — never the raw payload
        // (full entity object on add, {field:{from,to}} on edit).
        changes: panel.changes.map((c) => ({
          id: c.id,
          opType: c.opType,
          targetKind: c.targetKind,
          targetId: c.targetId,
          label: c.label,
          enabled: c.enabled,
          toggleGroupId: c.toggleGroupId,
          orderIndex: c.orderIndex,
          description: describeChange(c, panel.targetNames),
        })),
        toggleGroups: panel.toggleGroups,
      },
    };
  },
});

const compareScenarios = defineTool({
  name: "compare_scenarios",
  title: "Compare two scenarios",
  description:
    "Compare two scenarios side by side on lifetime tax and ending liquid portfolio (taxable + " +
    "cash + retirement + annuity + life insurance + accessible trust assets — excludes real " +
    "estate, business, and locked trust assets, matching get_monte_carlo). Each side also reports " +
    "taxGrounded: false means that side's tax figures came from flat-rate fallback. Each side is " +
    "a ref token: 'base', a scenario id, 'snap:<id>' for a frozen snapshot, or 'do-nothing'. Use " +
    "this to answer 'what does this change cost them'.",
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
    // F1: `.total` is Forge's OTHER portfolio figure — it rolls in real
    // estate, business and locked trust assets, and is explicitly documented
    // as the wrong one for a summary/KPI surface (`portfolio-snapshot.ts:
    // 48-56`, `live-solver-workspace.tsx:739-741`: "the KPI must not show
    // .total"). `.liquidTotal` is the canonical "Portfolio Assets"
    // reconciling figure (`types.ts:1805-1810`) and matches what
    // get_monte_carlo's bands are computed over (`endingLiquidAssets`).
    const endingPortfolio = (res: ProjectionResult) => res.years.at(-1)?.portfolioAssets.liquidTotal ?? 0;
    return {
      left: {
        ref: left,
        scenarioName: l.scenarioName,
        taxGrounded: isTaxGrounded(l.tree),
        lifetimeTax: lifetimeTax(l.result),
        endingPortfolio: endingPortfolio(l.result),
      },
      right: {
        ref: right,
        scenarioName: r.scenarioName,
        taxGrounded: isTaxGrounded(r.tree),
        lifetimeTax: lifetimeTax(r.result),
        endingPortfolio: endingPortfolio(r.result),
      },
    };
  },
});

const runProjection = defineTool({
  name: "run_projection",
  title: "Run the cash-flow projection",
  description:
    "Run Foundry's deterministic year-by-year projection and return the per-year story: total " +
    "income, total expenses, net cash flow, total tax, Medicare and IRMAA, and portfolio assets " +
    "(liquid investable total — taxable + cash + retirement + annuity + life insurance + " +
    "accessible trust assets; excludes real estate, business, and locked trust assets), plus the " +
    "first and second death years. If taxGrounded is false the tax figures came from flat-rate " +
    "fallback — do not present them as bracket-accurate. All numbers are the engine's own: " +
    "narrate them, never recompute.",
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
      // C3 (R49) + F1: `compactYear` passes `portfolioAssets` through whole —
      // eight account-UUID-keyed maps plus ~12 totals. compactYear itself is
      // shared with Forge and frozen (R2h); reduce AFTER it, on this MCP
      // path only. `.liquidTotal` (not `.total` — see F1 above) is the
      // canonical scalar.
      years: result.years.map((y) => ({ ...compactYear(y), portfolioAssets: y.portfolioAssets.liquidTotal })),
    };
  },
});

const getTaxProjection = defineTool({
  name: "get_tax_projection",
  title: "Tax projection by year",
  description:
    "Per-year federal and state tax detail for a household: taxable income by character, total " +
    "tax split into its federal (totalFederalTax) and state (stateTax) components, and Medicare " +
    "IRMAA surcharges. When taxGrounded is false these came from flat-rate fallback rather than " +
    "real brackets — say so. Use run_projection for the whole cash-flow picture; use this when " +
    "the question is specifically about taxes.",
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
        totalFederalTax: y.taxResult?.flow.totalFederalTax ?? null,
        stateTax: y.taxResult?.flow.stateTax ?? null,
        // F3: bySource dropped — see compactTaxDetail.
        taxDetail: y.taxDetail ? compactTaxDetail(y.taxDetail) : null,
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
    "failure rate, requestedTrials vs trialsRun, ending-balance percentiles, and per-year balance " +
    "bands. Reads from a per-scenario cache when the inputs haven't changed since the last run; a " +
    "cache miss reruns the full canonical simulation and writes the fresh result back to that " +
    "cache, which is slower. aborted true means the run was cut short and trialsRun is less than " +
    "requestedTrials — treat the percentiles and successRate as resting on a partial run, not the " +
    "full trial count, and say so. successRate is a fraction between 0 and 1.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
  }),
  page: "monteCarlo",
  handler: async ({ clientId, scenarioId }, { firmId }) => {
    const scenario = scenarioId ?? "base";
    // F2: no `refresh` input — Monte Carlo is stochastic, so a model-triggered
    // forced recompute would overwrite the probability-of-success figure the
    // advisor sees on the web page with a freshly re-rolled one. The cache key
    // is an input hash, so a stale entry can only ever be served when the plan
    // is UNCHANGED; the cache-fill-on-miss below stays (idempotent, same as
    // the web), only the model-triggerable overwrite is gone.
    const [cached, { effectiveTree }] = await Promise.all([
      getOrComputeMonteCarlo({ clientId, firmId, scenarioId: scenario, forceRefresh: false }),
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
      // F6: the only other truncation signal — omitting it let a truncated
      // run pass as a full one.
      aborted: summary.aborted,
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
    "line list — the hypothetical estate tax if both died today (headline federal/state/admin/" +
    "total figures for the client-first ordering, and for the spouse-first ordering when the " +
    "household is married), the year-by-year gift ledger, the trusts and business entities on " +
    "the plan, and any wills (bequests and residuary recipients). Use this for estate-tax " +
    "exposure and gifting questions.",
  inputSchema: z.object({ clientId: clientIdArg, scenarioId: scenarioArg }),
  page: "estate",
  handler: async ({ clientId, scenarioId }, { firmId }) => {
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenarioId ?? "base", {});
    const result = runProjectionWithEvents(effectiveTree);
    const hypo = result.todayHypotheticalEstateTax;
    return {
      scenarioId: scenarioId ?? "base",
      firstDeath: result.firstDeathEvent ?? null,
      secondDeath: result.secondDeathEvent ?? null,
      // F5: reduced to headline totals — see summarizeHypotheticalOrdering.
      todayHypotheticalEstateTax: {
        year: hypo.year,
        primaryFirst: summarizeHypotheticalOrdering(hypo.primaryFirst),
        ...(hypo.spouseFirst ? { spouseFirst: summarizeHypotheticalOrdering(hypo.spouseFirst) } : {}),
      },
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
