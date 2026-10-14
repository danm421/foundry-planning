// src/lib/whatif/run.ts
//
// Runs what-if variations through the real engine and the Solver's own
// solves. Pure of IO: the caller injects the starting tree and the two
// cache-backed loaders (Monte Carlo payload, Monte Carlo success).
//
// Variations run one after another. The engine is CPU-bound, so in-process
// parallelism buys nothing; fanning out across functions is future work.
import { runProjectionWithEvents } from "@/engine";
import type { ClientData } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { ResolutionContext } from "@/lib/projection/resolve-entity";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import { solveMaxSpending } from "@/lib/solver/solve-max-spending";
import { solveSsClaimAgeByPortfolio } from "@/lib/solver/solve-ss-portfolio";
import { solveTarget } from "@/lib/solver/solve-target";
import type { SolveLeverKey } from "@/lib/solver/solve-types";
import type { SolverMutation } from "@/lib/solver/types";
import type { SolveFor, WhatIfChange } from "./changes";
import { WhatIfValidationError } from "./errors";
import { caveatsFor, computeMetrics, metricDeltas, type MetricKey, type WhatIfMetrics } from "./metrics";
import { translateChanges, type TranslateOptions } from "./translate";
import { hasSpouse } from "./translate-context";

export interface VariantInput {
  label: string;
  changes: WhatIfChange[];
  solveFor?: SolveFor;
}

export interface PreparedVariant {
  label: string;
  /** Shared changes' mutations first, then the variation's own. */
  mutations: SolverMutation[];
  solveFor: SolveFor | null;
  /** The conversion a roth_amount solve varies — the id the translator gave it. */
  rothTechniqueId: string | null;
  addsAccounts: boolean;
}

export interface SolveOutcome {
  kind: SolveFor["kind"];
  value: number;
  status: "converged" | "unreachable" | "max-iterations";
  /** Probability of success at the solved value; null for the claim-age solve (no Monte Carlo). */
  achievedSuccess: number | null;
  /** Claim-age solve only: every age tried, with its ending portfolio. */
  candidates?: { value: number; endingPortfolio: number }[];
}

export interface VariantResult {
  label: string;
  status: "done" | "failed";
  error?: string;
  metrics?: WhatIfMetrics;
  /** Against today's plan (the baseline row). */
  deltas?: Partial<Record<MetricKey, number>>;
  solve: SolveOutcome | null;
  caveats: string[];
  rank?: number | null;
}

export interface RunOutput {
  baseline: VariantResult;
  variants: VariantResult[];
  unfinished: string[];
}

export interface Solvers {
  maxSpending: typeof solveMaxSpending;
  target: typeof solveTarget;
  ssClaimAge: typeof solveSsClaimAgeByPortfolio;
}

export interface RunDeps {
  /** The starting scenario's effective tree. */
  tree: ClientData;
  resolutionContext?: ResolutionContext;
  loadMcPayload: (working: ClientData) => Promise<MonteCarloPayload>;
  /** Monte Carlo probability of success for the starting tree plus these mutations (cached). */
  monteCarloSuccess: (mutations: SolverMutation[]) => Promise<number>;
  now: () => number;
  /** Test seam; defaults to the real Solver solves. */
  solvers?: Partial<Solvers>;
}

function withPrefix<T>(prefix: string | null, fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    if (prefix && err instanceof WhatIfValidationError) {
      throw new WhatIfValidationError(`${prefix} — ${err.message}`);
    }
    throw err;
  }
}

export function prepareVariants(
  tree: ClientData,
  shared: WhatIfChange[],
  variants: VariantInput[],
  newId?: () => string,
  opts: TranslateOptions = {},
): PreparedVariant[] {
  const labels = new Set<string>();
  for (const v of variants) {
    if (labels.has(v.label)) {
      throw new WhatIfValidationError(`Two variations are both labelled "${v.label}". Give each a different label.`);
    }
    labels.add(v.label);
  }
  const sharedOut = withPrefix("Shared changes", () => translateChanges(tree, shared, newId, opts));
  const single = variants.length === 1 && shared.length === 0;

  return variants.map((v) => {
    const prefix = single ? null : `Variation "${v.label}"`;
    const own = withPrefix(prefix, () => translateChanges(tree, v.changes, newId, opts));
    const mutations = [...sharedOut.mutations, ...own.mutations];
    const solveFor = v.solveFor ?? null;
    const refuse = (message: string): never => {
      throw new WhatIfValidationError(prefix ? `${prefix} — ${message}` : message);
    };

    if (solveFor && "person" in solveFor && solveFor.person === "spouse" && !hasSpouse(tree)) {
      refuse("solveFor names the spouse, but this household has no spouse.");
    }

    let rothTechniqueId: string | null = null;
    if (solveFor?.kind === "roth_amount") {
      const change = v.changes[solveFor.changeIndex];
      if (!change || change.type !== "roth_conversion" || change.mode !== "fixed_amount") {
        refuse("solveFor roth_amount needs changeIndex to point at a fixed_amount roth_conversion change in this variation.");
      }
      rothTechniqueId = own.recordIds[solveFor.changeIndex];
    }

    if (solveFor?.kind === "savings") {
      const rules = applyMutations(tree, mutations).savingsRules.filter((r) => r.accountId === solveFor.accountId);
      if (rules.length === 0) {
        refuse("solveFor savings needs an account that has a savings rule.");
      }
      // The solve searches a dollar amount, which the engine ignores while a
      // percent of salary (savings.ts) or the IRS maximum (projection.ts) is set.
      if (rules.some((r) => (r.annualPercent ?? 0) > 0)) {
        refuse(
          "solveFor savings searches a dollar amount, but this account saves a percent of salary. Add a savings_amount change for this account first.",
        );
      }
      if (rules.some((r) => r.contributeMax)) {
        refuse(
          "solveFor savings searches a dollar amount, but this account contributes the IRS maximum. Add a savings_max change for this account with contributeMax false first.",
        );
      }
    }

    return {
      label: v.label,
      mutations,
      solveFor,
      rothTechniqueId,
      addsAccounts: [...shared, ...v.changes].some((c) => c.type === "add_account"),
    };
  });
}

/** True for a mutation that sets the lever a solve is about to search — the
 *  solve must not see a fixed value for it (solve-types.ts). A savings
 *  solve's lever is the dollar amount alone: a savings_amount's percent-clear
 *  stays, or the old percent of salary would win over every amount tried. */
function isSolvedLever(m: SolverMutation, s: SolveFor): boolean {
  if (s.kind === "retirement_age") return m.kind === "retirement-age" && m.person === s.person;
  if (s.kind === "savings") return m.kind === "savings-contribution" && m.accountId === s.accountId;
  return false;
}

async function runSolve(deps: RunDeps, v: PreparedVariant, working: ClientData): Promise<SolveOutcome> {
  const s = v.solveFor!;
  const solvers: Solvers = {
    maxSpending: solveMaxSpending,
    target: solveTarget,
    ssClaimAge: solveSsClaimAgeByPortfolio,
    ...deps.solvers,
  };

  if (s.kind === "ss_claim_age") {
    // The engine reads claimingAge only in "years" mode (socialSecurity/claimAge.ts).
    const baselineMutations: SolverMutation[] = [
      ...v.mutations,
      { kind: "ss-claim-age-mode", person: s.person, mode: "years" },
    ];
    const r = solvers.ssClaimAge({
      effectiveTree: deps.tree,
      baselineMutations,
      person: s.person,
      resolutionContext: deps.resolutionContext,
    });
    return { kind: s.kind, value: r.solvedValue, status: r.status, achievedSuccess: null, candidates: r.candidates };
  }

  const mcPayload = await deps.loadMcPayload(working);
  if (s.kind === "max_spending") {
    const r = await solvers.maxSpending({ tree: working, mcPayload, targetPoS: s.targetSuccess, searchTrials: 250 });
    return { kind: s.kind, value: r.realAnnualSpend, status: r.status, achievedSuccess: r.achievedPoS };
  }

  const target: SolveLeverKey =
    s.kind === "retirement_age"
      ? { kind: "retirement-age", person: s.person }
      : s.kind === "savings"
        ? { kind: "savings-contribution", accountId: s.accountId }
        : { kind: "roth-conversion-amount", techniqueId: v.rothTechniqueId! };
  const r = await solvers.target({
    effectiveTree: deps.tree,
    mcPayload,
    baselineMutations: v.mutations.filter((m) => !isSolvedLever(m, s)),
    target,
    targetPoS: s.targetSuccess,
    resolutionContext: deps.resolutionContext,
  });
  if (r.objective !== "pos") throw new Error(`unexpected solve objective ${r.objective}`);
  return { kind: s.kind, value: r.solvedValue, status: r.status, achievedSuccess: r.achievedPoS };
}

async function evaluate(deps: RunDeps, v: PreparedVariant, includeMonteCarlo: boolean): Promise<VariantResult> {
  let working = applyMutations(deps.tree, v.mutations);
  if (deps.resolutionContext) working = resolveTechniqueMutations(working, v.mutations, deps.resolutionContext);
  const projection = runProjectionWithEvents(working);
  const successRate = includeMonteCarlo ? await deps.monteCarloSuccess(v.mutations) : null;
  const solve = v.solveFor ? await runSolve(deps, v, working) : null;
  const metrics = computeMetrics(working, projection, successRate);
  return {
    label: v.label,
    status: "done",
    metrics,
    solve,
    caveats: caveatsFor({ tree: working, metrics, solveStatus: solve?.status ?? null, addedAccounts: v.addsAccounts }),
  };
}

export async function runPrepared(args: {
  deps: RunDeps;
  variants: PreparedVariant[];
  includeMonteCarlo: boolean;
  budgetMs: number;
  onProgress?: (done: number) => void | Promise<void>;
}): Promise<RunOutput> {
  const { deps, includeMonteCarlo } = args;
  const start = deps.now();
  const baseline = await evaluate(
    deps,
    { label: "Current plan", mutations: [], solveFor: null, rothTechniqueId: null, addsAccounts: false },
    includeMonteCarlo,
  );

  const variants: VariantResult[] = [];
  const unfinished: string[] = [];
  for (const v of args.variants) {
    if (deps.now() - start > args.budgetMs) {
      unfinished.push(v.label);
      continue;
    }
    let row: VariantResult;
    try {
      row = await evaluate(deps, v, includeMonteCarlo);
      row.deltas = metricDeltas(baseline.metrics!, row.metrics!);
    } catch (err) {
      console.error("[whatif] variation failed:", v.label, err);
      row = { label: v.label, status: "failed", error: "Foundry couldn't run this variation.", solve: null, caveats: [] };
    }
    variants.push(row);
    await args.onProgress?.(variants.length);
  }
  return { baseline, variants, unfinished };
}
