import { z } from "zod";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { ADAPTERS, SUBJECT_KEYS } from "@/lib/projection-explain/registry";
import { explainChange, explainComposition } from "@/lib/projection-explain/explain";
import { buildDrillContext } from "@/lib/projection-explain/context";
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";
import { solveSsClaimAgeByPortfolio } from "@/lib/solver/solve-ss-portfolio";
import { runProjectionWithEvents } from "@/engine";
import { defineTool, type McpTool } from "../define-tool";

const clientIdArg = z
  .string()
  .describe(
    "Planning client id from search_clients (the clientId field, present only when " +
      "hasPlan is true). NOT a CRM household id.",
  );
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

/** Disclosure for analyze_social_security, whose "ending portfolio" is the
 *  engine's liquid figure (portfolioAssets.liquidTotal) — the same scalar
 *  solveSsClaimAgeByPortfolio computes and the same one get_monte_carlo and
 *  the plan tools (Task 10) use. */
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
    "causes. When the asked year is one row off the real cliff, the payload also carries a " +
    "probableIntendedJump object — an already-explained nearby boundary the advisor probably " +
    "meant. Only the 'tax' subject exists today. estimatedImpact values are approximations — " +
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
    "a fraction between 0.01 and 0.99. realAnnualSpend is in today's dollars (real), rounded to " +
    "the nearest $5,000. Reads from a per-scenario cache when the inputs haven't changed since " +
    "the last solve; a cache miss reruns the search and writes the fresh result back to that " +
    "cache, which is slower. status 'unreachable' means no spending level hits the target; " +
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

const analyzeSocialSecurity = defineTool({
  name: "analyze_social_security",
  title: "Analyze Social Security claiming age",
  description:
    "Solve the Social Security claiming age (62-70) that maximizes a household member's " +
    "FINAL-YEAR liquid portfolio, and return the candidate ages considered with that final-year " +
    "portfolio for each. Deterministic: one straight-line projection per integer age, no Monte " +
    "Carlo; ties break toward the earliest age. Forces claim-age mode to 'years' for every " +
    "candidate, overriding a household actually set to claim at FRA or at retirement — this " +
    "solves for the AGE, not the household's current claiming strategy. " +
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
  analyzeSocialSecurity,
];
