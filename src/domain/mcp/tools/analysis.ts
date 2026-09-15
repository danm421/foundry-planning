import { z } from "zod";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { ADAPTERS, SUBJECT_KEYS } from "@/lib/projection-explain/registry";
import { explainChange, explainComposition } from "@/lib/projection-explain/explain";
import { buildDrillContext } from "@/lib/projection-explain/context";
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";
import { solveSsClaimAgeByPortfolio } from "@/lib/solver/solve-ss-portfolio";
import { applyMutations } from "@/lib/solver/apply-mutations";
import type { SolverMutation } from "@/lib/solver/types";
import { runProjection, runProjectionWithEvents } from "@/engine";
import type { ProjectionYear } from "@/engine";
import type { RothConversion } from "@/engine/types";
import { defineTool, type McpTool } from "../define-tool";

const clientIdArg = z.string().describe("Household id from search_clients.");
const scenarioArg = z.string().optional().describe("Scenario id, or omit for the base case.");

// SUBJECT_KEYS is ["tax"] — the one registered SubjectAdapter today. Widening
// this enum means registering a new adapter in the projection-explain
// registry, not editing this file. No cast: SUBJECT_KEYS is typed
// `SubjectKey[]`, so z.enum infers `subject: SubjectKey` end to end and
// `ADAPTERS[subject]` below indexes without a cast (mirrors
// src/domain/forge/tools/compute.ts:167,130,193, on the same zod version).
const subjectArg = z
  .enum(SUBJECT_KEYS)
  .describe("Which figure. Only 'tax' is supported today.");

/** Shared disclosure for both tools whose "ending portfolio" is the engine's
 *  liquid figure (portfolioAssets.liquidTotal) — the same scalar
 *  solveSsClaimAgeByPortfolio computes and the same one get_monte_carlo and
 *  the plan tools (Task 10) use. Stating the exclusions here keeps the two
 *  tools in this file from drifting on the same disclosure. */
const LIQUID_PORTFOLIO_NOTE =
  "endingPortfolio is the liquid portfolio (taxable + cash + retirement + annuity + life " +
  "insurance + accessible trust assets) — it excludes home/real estate, business, stock " +
  "options, and locked trust assets.";

const explainProjectionChange = defineTool({
  name: "explain_projection_change",
  title: "Explain a tax change between years",
  description:
    "Explain WHY a household's tax bill changed between two projection years. Returns the " +
    "from/to/delta headline, federal and state tax-line deltas, income-composition deltas, " +
    "per-source recognized-income deltas, the per-account withdrawal picture, and ranked root " +
    "causes. Only the 'tax' subject exists today. estimatedImpact values are approximations — " +
    "present them as estimates; exact movement is in taxLineDeltas.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
    subject: subjectArg,
    year: z.number().int().describe("The year whose change to explain."),
    compareYear: z.number().int().optional().describe("Baseline year; defaults to year − 1."),
  }),
  page: "tax",
  handler: async ({ clientId, scenarioId, subject, year, compareYear }, { firmId }) => {
    const scenario = scenarioId ?? "base";
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenario, {});
    const result = runProjectionWithEvents(effectiveTree);
    const explanation = explainChange({
      adapter: ADAPTERS[subject],
      years: result.years,
      firstDeathYear: result.firstDeathEvent?.year ?? null,
      secondDeathYear: result.secondDeathEvent?.year ?? null,
      year,
      compareYear,
      ctx: buildDrillContext(effectiveTree, result.years),
    });
    // The pure engine cannot know the scenario identity — fill it from
    // context, mirroring break_down_projection_figure below (both sides of
    // Forge's compute.ts do this so the two sibling tools never disagree on
    // the same household in the same conversation).
    if (explanation.available) explanation.analysisContext.scenarioId = scenario;
    return { scenarioId: scenario, ...explanation };
  },
});

const breakDownProjectionFigure = defineTool({
  name: "break_down_projection_figure",
  title: "Break down a tax figure for one year",
  description:
    "Decompose a household's tax bill for a single projection year into its components, " +
    "optionally against a reference (the prior year, the plan average, the working years, or a " +
    "specific year). Only the 'tax' subject exists today. Use explain_projection_change when the " +
    "question is why it MOVED; use this when the question is what it is MADE OF.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
    subject: subjectArg,
    year: z.number().int().describe("The projection year to decompose."),
    compareTo: z
      .union([z.enum(["none", "prior_year", "plan_average", "working_years"]), z.number().int()])
      .optional()
      .describe("Reference for level comparison; omit for pure composition."),
  }),
  page: "tax",
  handler: async ({ clientId, scenarioId, subject, year, compareTo }, { firmId }) => {
    const scenario = scenarioId ?? "base";
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenario, {});
    const result = runProjectionWithEvents(effectiveTree);
    const composition = explainComposition({
      adapter: ADAPTERS[subject],
      years: result.years,
      year,
      compareTo: compareTo ?? "none",
      ctx: buildDrillContext(effectiveTree, result.years),
    });
    // The pure engine cannot know the scenario identity — fill it from context.
    if (composition.available) composition.analysisContext.scenarioId = scenario;
    return { scenarioId: scenario, ...composition };
  },
});

const solveMaxSpendingTool = defineTool({
  name: "solve_max_spending",
  title: "Solve maximum sustainable spending",
  description:
    "Solve the highest annual spending a household can sustain while still hitting a target " +
    "probability of success. Answers 'how much can they spend and still be at 85%'. targetPoS is " +
    "a fraction between 0.01 and 0.99. The result is in today's dollars (real). Reads from a " +
    "per-scenario cache when the inputs haven't changed since the last solve; a cache miss reruns " +
    "the search, which is slower. status 'unreachable' means no spending level hits the target; " +
    "'max-iterations' means the solver stopped early and the number is approximate.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
    targetPoS: z.number().min(0.01).max(0.99).describe("Target probability of success, e.g. 0.85."),
  }),
  page: "monteCarlo",
  handler: async ({ clientId, scenarioId, targetPoS }, { firmId }) => {
    const scenario = scenarioId ?? "base";
    // The canonical cached path (5 production call sites): loads the tree,
    // loads the Monte Carlo simulation inputs off that SAME tree, hashes them
    // with targetPoS, and either serves the cached MaxSpendResult or solves
    // and caches it. Do not hand-assemble loadEffectiveTree +
    // getOrComputeMonteCarlo + solveMaxSpending here — getOrComputeMonteCarlo's
    // payload is a report view-model (indices/correlation/accountMixes are not
    // on it), not the MonteCarloPayload solveMaxSpending's evaluator needs.
    const solved = await getOrComputeMaxSpending({ clientId, firmId, scenarioId: scenario, targetPoS });
    return { scenarioId: scenario, targetPoS, ...solved };
  },
});

const analyzeRothConversion = defineTool({
  name: "analyze_roth_conversion",
  title: "Analyze Roth conversions",
  description:
    "Model one or more Roth conversions against a household's current plan and report the effect " +
    "on lifetime tax and ending portfolio. " +
    LIQUID_PORTFOLIO_NOTE +
    " Nothing is saved — this is analysis only. You need account ids from list_plan_details with " +
    "kind 'account': a pre-tax source account to drain and a Roth destination account to fund.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
    conversions: z
      .array(
        z.object({
          id: z.string().describe("Any unique string identifying this conversion."),
          name: z.string().optional(),
          year: z.number().int().describe("Calendar year of the conversion."),
          amount: z.number().positive().describe("Gross dollars converted that year."),
          sourceAccountId: z.string().describe("Pre-tax account id to drain."),
          destinationAccountId: z.string().describe("Roth account id to fund."),
        }),
      )
      .min(1)
      .describe("The conversions to model."),
  }),
  page: "tax",
  handler: async ({ clientId, scenarioId, conversions }, { firmId }) => {
    const scenario = scenarioId ?? "base";
    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, scenario, {});
    const baseline = runProjection(effectiveTree);
    // One roth-conversion-upsert mutation PER conversion, each carrying a full
    // RothConversion as `value` — apply-mutations.ts reads m.id/m.value off
    // each mutation individually; there is no batched `conversions` field on
    // the mutation itself. Mirrors src/domain/forge/tools/whatif.ts's
    // whatifRoth mapping exactly. `satisfies RothConversion`, no cast, so tsc
    // checks the shape end to end.
    const mutations: SolverMutation[] = conversions.map((c) => ({
      kind: "roth-conversion-upsert",
      id: c.id,
      value: {
        id: c.id,
        name: c.name ?? `Roth conversion ${c.year}`,
        destinationAccountId: c.destinationAccountId,
        sourceAccountIds: [c.sourceAccountId],
        conversionType: "fixed_amount",
        fixedAmount: c.amount,
        startYear: c.year,
        endYear: c.year,
        indexingRate: 0,
      } satisfies RothConversion,
    }));
    const withConversions = runProjection(applyMutations(effectiveTree, mutations));
    const lifetimeTax = (years: ProjectionYear[]) =>
      years.reduce((s, y) => s + (y.taxResult?.flow.totalTax ?? 0), 0);
    // .liquidTotal, never the legacy .total — the canonical "Portfolio Assets"
    // figure (src/engine/types.ts), the same scalar
    // solveSsClaimAgeByPortfolio below independently computes the same way.
    const endingPortfolio = (years: ProjectionYear[]) => years.at(-1)?.portfolioAssets.liquidTotal ?? 0;
    return {
      scenarioId: scenario,
      baseline: { lifetimeTax: lifetimeTax(baseline), endingPortfolio: endingPortfolio(baseline) },
      withConversions: {
        lifetimeTax: lifetimeTax(withConversions),
        endingPortfolio: endingPortfolio(withConversions),
      },
      lifetimeTaxDelta: lifetimeTax(withConversions) - lifetimeTax(baseline),
      endingPortfolioDelta: endingPortfolio(withConversions) - endingPortfolio(baseline),
      note: "Modeled only — nothing was saved to the household's plan.",
    };
  },
});

const analyzeSocialSecurity = defineTool({
  name: "analyze_social_security",
  title: "Analyze Social Security claiming age",
  description:
    "Solve the Social Security claiming age (62-70) that maximizes a household member's ending " +
    "portfolio, and return the candidate ages considered with the ending portfolio for each. " +
    "Deterministic: one straight-line projection per integer age, no Monte Carlo; ties break " +
    "toward the earliest age. " +
    LIQUID_PORTFOLIO_NOTE +
    " Nothing is saved. Pick 'client' or 'spouse' for whose claim age to solve.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
    person: z.enum(["client", "spouse"]).describe("Whose claiming age to solve."),
  }),
  page: "cashflow",
  handler: async ({ clientId, scenarioId, person }, { firmId }) => {
    const scenario = scenarioId ?? "base";
    const { effectiveTree, resolutionContext } = await loadEffectiveTree(clientId, firmId, scenario, {});
    const solved = solveSsClaimAgeByPortfolio({
      effectiveTree,
      baselineMutations: [],
      person,
      resolutionContext,
    });
    return {
      scenarioId: scenario,
      person,
      status: solved.status,
      solvedClaimAge: solved.solvedValue,
      endingPortfolio: solved.endingPortfolio,
      // candidates[].value → claimAge: a field named `value` sitting next to
      // `endingPortfolio` is a name a model will misquote. Matches
      // whatif_social_security. finalProjection (a whole ProjectionYear[])
      // stays dropped — never spread `...solved`.
      candidates: solved.candidates.map((c) => ({ claimAge: c.value, endingPortfolio: c.endingPortfolio })),
      note: "Modeled only — nothing was saved to the household's plan.",
    };
  },
});

export const analysisTools: McpTool[] = [
  explainProjectionChange,
  breakDownProjectionFigure,
  solveMaxSpendingTool,
  analyzeRothConversion,
  analyzeSocialSecurity,
];
