// src/domain/mcp/tools/whatif.ts
//
// What-ifs through Foundry's engine: one at a time (try_what_if), many at
// once (compare_what_ifs), and the check-back for a run that outlives a
// call (get_what_if_results). Nothing here saves anything.
import { z } from "zod";
import { foundryScenarioUrl } from "@/lib/mcp/foundry-url";
import {
  computeWeight,
  isHeavy,
  JOB_BUDGET_MS,
  MAX_CHANGES,
  MAX_VARIANTS_DETERMINISTIC,
  POLL_INTERVAL_MS,
  POLL_WAIT_MS,
  variantCap,
} from "@/lib/whatif/caps";
import { SOLVE_FOR_SCHEMA, WHAT_IF_CHANGE_SCHEMA, type WhatIfChange } from "@/lib/whatif/changes";
import { WhatIfValidationError } from "@/lib/whatif/errors";
import { getJobKv, readJobFor, waitForJob, type WhatIfJob } from "@/lib/whatif/job-store";
import { checkRankBy, rankVariants, RANK_METRICS, type RankMetric } from "@/lib/whatif/rank";
import { prepareVariants, runPrepared, type RunOutput, type VariantInput } from "@/lib/whatif/run";
import { growthDefaultsFrom } from "@/lib/whatif/translate";
import type { McpToolContext } from "../context";
import { defineTool, McpUnavailableError, type McpTool } from "../define-tool";
import { assertClientReadableForPrincipal, McpForbiddenError } from "../guards";
import { buildRunDeps, chargeCompute, startWhatIfJob, type JobOutcome } from "../whatif-jobs";

export const JOB_NOT_FOUND_MESSAGE =
  "What-if run not found. Runs are kept for 24 hours, for the advisor who started them.";
const STILL_RUNNING = "Still running. Call get_what_if_results with this jobId.";

const clientIdArg = z
  .string()
  .describe("Planning client id from search_clients (the clientId field, present only when hasPlan is true). NOT a CRM household id.");
const scenarioArg = z.string().optional().describe("Starting scenario id from list_scenarios, or omit for the base case.");
const changesArg = z
  .array(WHAT_IF_CHANGE_SCHEMA)
  .max(MAX_CHANGES)
  .describe("Plain changes. Record ids come from list_plan_details.");

const METRICS_NOTE =
  "Metrics: successRate (Monte Carlo, only when it ran), endingPortfolio (liquid portfolio in the last plan year), " +
  "lifetimeTax, netToHeirs (already net of heirs' income tax on inherited IRAs, and including lifetime gifts — it " +
  "matches the Solver's \"Total to Heirs\"), heirIncomeTax, yearsFullyFunded, firstShortfallYear. Pass every caveat " +
  "on to the advisor. Narrate the engine's numbers; never recompute them.";

const SOLVE_STATUS_NOTE =
  " A solve's status is 'converged' (it found the value that meets the target), 'max-iterations' (it stopped " +
  "before fully settling, so the value is approximate) or 'unreachable' (moving that one lever can't reach the " +
  "target: the value is the closest the search got and misses the target, so never present it as the answer).";

const INCOME_YEARS_NOTE =
  " income_years can't move an income year tied to retirement (change retirement_age instead) or a Social Security " +
  "row (change ss_claim_age instead).";

/** Metrics and deltas as Claude reads them: success rates to 4 decimals, every
 *  other figure to the cent. Engine arithmetic otherwise leaks out as
 *  0.05000000000000004. Solve values are passed through untouched. */
function rounded<T extends object>(figures: T | undefined): T | null {
  if (!figures) return null;
  const scale = (key: string) => (key === "successRate" ? 1e4 : 1e2);
  return Object.fromEntries(
    Object.entries(figures).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * scale(k)) / scale(k) : v]),
  ) as T;
}

export function tryResult(out: RunOutput) {
  const v = out.variants[0];
  return {
    current: rounded(out.baseline.metrics),
    whatIf: rounded(v?.metrics),
    deltas: rounded(v?.deltas),
    solve: v?.solve ?? null,
    caveats: v?.caveats ?? [],
    ...(v?.status === "failed" ? { error: v.error } : {}),
  };
}

export function compareResult(out: RunOutput, rankBy?: { metric: RankMetric; direction?: "asc" | "desc" }) {
  const ranked = rankVariants(out.variants, rankBy);
  return {
    baseline: { label: out.baseline.label, metrics: rounded(out.baseline.metrics) },
    variants: ranked.rows.map((r) => ({
      label: r.label,
      status: r.status,
      rank: r.rank ?? null,
      metrics: rounded(r.metrics),
      deltas: rounded(r.deltas),
      solve: r.solve,
      ...(r.error ? { error: r.error } : {}),
    })),
    best: ranked.best,
    unfinished: out.unfinished,
    caveats: [...new Set([...out.baseline.caveats, ...out.variants.flatMap((r) => r.caveats)])],
  };
}

function present(outcome: JobOutcome) {
  return outcome.status === "running" ? { ...outcome, message: STILL_RUNNING } : outcome;
}

/** The run behind try_what_if and compare_what_ifs: load the starting
 *  scenario, translate the changes, charge the compute limit, then run inline
 *  when deterministic or as a job when it runs Monte Carlo. */
async function runWhatIfs(
  { principal, firmId }: McpToolContext,
  args: {
    clientId: string;
    scenarioId: string | undefined;
    shared: WhatIfChange[];
    variants: VariantInput[];
    mc: boolean;
    kind: WhatIfJob["kind"];
    toResult: (out: RunOutput) => unknown;
  },
) {
  const { clientId, mc } = args;
  const scenario = args.scenarioId ?? "base";
  const deps = await buildRunDeps(clientId, firmId, scenario);
  const variants = prepareVariants(deps.tree, args.shared, args.variants, undefined, {
    growthDefaults: growthDefaultsFrom(deps.resolutionContext),
  });
  await chargeCompute(principal, computeWeight(variants, mc));
  const run = (onProgress?: (done: number) => Promise<void>) =>
    runPrepared({ deps, variants, includeMonteCarlo: mc, budgetMs: JOB_BUDGET_MS, onProgress }).then(args.toResult);
  const outcome: JobOutcome = mc
    ? await startWhatIfJob({ principal, clientId, kind: args.kind, total: variants.length, work: run })
    : { status: "done", result: await run() };
  return {
    scenarioId: scenario,
    // foundryUrl (added by defineTool) opens the Solver on the base case.
    ...(scenario !== "base" ? { scenarioUrl: foundryScenarioUrl(clientId, scenario) } : {}),
    ...present(outcome),
  };
}

const tryWhatIf = defineTool({
  name: "try_what_if",
  title: "Try a what-if",
  description:
    "Run one what-if on a household's plan through Foundry's engine and compare it with the current plan. Nothing is " +
    "saved. `changes` is a list of plain changes — retire at 62, spend 10% less, convert to Roth filling the 24% " +
    "bracket, sell the rental in 2030, claim Social Security at 70 — with record ids from list_plan_details." +
    INCOME_YEARS_NOTE +
    " Optional `solveFor` finds a number: the most they can spend at a target success rate, the retirement age or " +
    "savings that reaches it, a Roth conversion amount, or the best Social Security claim age. `includeMonteCarlo` " +
    "adds the probability of success; every solve except the claim age includes it anyway. " +
    METRICS_NOTE +
    SOLVE_STATUS_NOTE +
    " A run with Monte Carlo or a solve can take a minute or more: if it isn't done within about 45 seconds you get " +
    "{ status: 'running', jobId } — call get_what_if_results with it. To test several variations at once use " +
    "compare_what_ifs. To keep a what-if, call save_what_if_as_scenario with the same changes.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
    changes: changesArg.optional(),
    solveFor: SOLVE_FOR_SCHEMA.optional(),
    includeMonteCarlo: z.boolean().optional().describe("Add the Monte Carlo probability of success. Slower."),
  }),
  page: "scenarios",
  handler: ({ clientId, scenarioId, changes, solveFor, includeMonteCarlo }, ctx) =>
    runWhatIfs(ctx, {
      clientId,
      scenarioId,
      shared: [],
      variants: [{ label: "What-if", changes: changes ?? [], ...(solveFor ? { solveFor } : {}) }],
      // A success-based solve implies Monte Carlo (spec), so "heavy" and "runs
      // Monte Carlo" are one and the same here.
      mc: isHeavy(solveFor, includeMonteCarlo ?? false),
      kind: "try",
      toResult: tryResult,
    }),
});

const variantSchema = z.object({
  label: z.string().min(1).max(60).describe("A short, unique name for this variation, e.g. 'Retire 62'."),
  changes: changesArg,
  solveFor: SOLVE_FOR_SCHEMA.optional(),
});

const compareWhatIfs = defineTool({
  name: "compare_what_ifs",
  title: "Compare what-ifs",
  description:
    "Test several variations of a household's plan in one run and get one table back, optionally ranked. Each " +
    "variation has a label, its own changes and an optional solveFor; sharedChanges apply to every variation. " +
    "Nothing is saved. For two scenarios already saved in Foundry, use compare_scenarios instead. The baseline row " +
    "is today's plan without changes. Example — retirement ages: variations " +
    "'Retire 60' through 'Retire 67', each with a retirement_age change and solveFor { kind: 'max_spending', " +
    "targetSuccess: 0.85 }, plus an 'As planned' variation with no changes. Example — Roth strategy: 'No conversions' " +
    "(no changes), 'Fill 22% to 2032', 'Fill 24% to 2032' and 'Fill 24%, IRMAA-free' (irmaaCapTier 0), each a " +
    "roth_conversion change, ranked by netToHeirs or lifetimeTax." +
    INCOME_YEARS_NOTE +
    " " +
    METRICS_NOTE +
    SOLVE_STATUS_NOTE +
    " Any solve except the claim age runs Monte Carlo on every row. At most 10 variations when Monte Carlo or a " +
    "success-based solve is involved, 25 otherwise. A comparison with Monte Carlo or solves usually takes minutes: " +
    "you get { status: 'running', jobId } — call get_what_if_results until it's done. `unfinished` lists variations " +
    "that didn't fit the time budget; run them in a follow-up call.",
  inputSchema: z.object({
    clientId: clientIdArg,
    scenarioId: scenarioArg,
    sharedChanges: changesArg.optional(),
    variants: z.array(variantSchema).min(1).max(MAX_VARIANTS_DETERMINISTIC),
    rankBy: z
      .object({
        metric: z.enum(RANK_METRICS),
        direction: z
          .enum(["asc", "desc"])
          .optional()
          .describe(
            "Default: the better direction for that metric. Ranking by solvedValue needs every variation to solve " +
              "for the same thing, and a direction for Roth-amount or claim-age solves. A failed row, or one whose " +
              "solve is 'unreachable', gets no rank.",
          ),
      })
      .optional(),
    includeMonteCarlo: z.boolean().optional().describe("Add the Monte Carlo probability of success to every row."),
  }),
  page: "scenarios",
  handler: async ({ clientId, scenarioId, sharedChanges, variants, rankBy, includeMonteCarlo }, ctx) => {
    // A success-based solve in any variation implies Monte Carlo for every
    // row (spec), so "heavy" and "runs Monte Carlo" are one and the same here.
    const mc = variants.some((v) => isHeavy(v.solveFor, includeMonteCarlo ?? false));
    const cap = variantCap(mc);
    if (variants.length > cap) {
      throw new WhatIfValidationError(
        `That's ${variants.length} variations; at most ${cap} variations run in one call${mc ? " when Monte Carlo or a solve is involved" : ""}. ` +
          `Split them into calls of ${cap}.`,
      );
    }
    checkRankBy(rankBy, variants.map((v) => v.solveFor?.kind ?? null), mc);
    return runWhatIfs(ctx, {
      clientId,
      scenarioId,
      shared: sharedChanges ?? [],
      variants,
      mc,
      kind: "compare",
      toResult: (out) => compareResult(out, rankBy),
    });
  },
});

const getWhatIfResults = defineTool({
  name: "get_what_if_results",
  title: "Get what-if results",
  description:
    "Check on a what-if run started by try_what_if or compare_what_ifs. Waits up to about 50 seconds for it to " +
    "finish, then returns { status, progress, result }. While status is 'running', call again with the same jobId. " +
    "result is exactly what the starting tool would have returned. Runs are kept for 24 hours, only for the advisor " +
    "who started them.",
  inputSchema: z.object({ jobId: z.string().min(1).max(100) }),
  handler: async ({ jobId }, { principal }) => {
    const kv = getJobKv();
    if (!kv) throw new McpUnavailableError();
    const who = { firmId: principal.orgId, userId: principal.userId };
    const read = async () => {
      try {
        return await readJobFor(kv, jobId, who);
      } catch (err) {
        console.error("[whatif-jobs] read failed", err);
        throw new McpUnavailableError();
      }
    };
    const first = await read();
    if (!first) throw new McpForbiddenError(JOB_NOT_FOUND_MESSAGE);
    // The advisor may have lost access to this client since the run started.
    // Only a denial reads as "not found"; any other failure (the access lookup
    // itself failing) propagates, so a finished run never looks lost.
    try {
      await assertClientReadableForPrincipal(principal, first.clientId);
    } catch (err) {
      if (err instanceof McpForbiddenError) throw new McpForbiddenError(JOB_NOT_FOUND_MESSAGE);
      throw err;
    }
    const job =
      first.status === "running"
        ? ((await waitForJob(read, { timeoutMs: POLL_WAIT_MS, intervalMs: POLL_INTERVAL_MS })) ?? first)
        : first;
    if (job.status === "running") return { status: "running", jobId, progress: job.progress, message: STILL_RUNNING };
    if (job.status === "failed") return { status: "failed", error: job.error ?? "Foundry couldn't finish this run." };
    return { status: "done", result: job.result };
  },
});

export const whatifTools: McpTool[] = [tryWhatIf, compareWhatIfs, getWhatIfResults];
