// src/domain/forge/tools/whatif.ts
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { ForgeToolContext } from "../context";
import { assertClientReadable, ForbiddenScopeError } from "../guards";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection, runProjectionWithEvents } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { solveTarget } from "@/lib/solver/solve-target";
import { solveMaxSpending } from "@/lib/solver/solve-max-spending";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import type { SolveLeverKey, PoSSolveResult } from "@/lib/solver/solve-types";
import type { SolverMutation, SolverPerson } from "@/lib/solver/types";
import type {
  RothConversion,
  ProjectionYear,
  HypotheticalEstateTaxOrdering,
} from "@/engine/types";
import { solveSsClaimAgeByPortfolio } from "@/lib/solver/solve-ss-portfolio";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import type { ScenarioChange } from "@/engine/scenario/types";
import {
  runLifeInsuranceWhatIf,
  survivorEndingPortfolio,
} from "@/engine/what-if/life-insurance-need";

/**
 * Shared preamble for every what-if tool: the model-supplied clientId must equal
 * the server-derived ctx.clientId, and the bound client must pass the firm
 * tenant check — both enforced by assertClientReadable (the pinned scope guard).
 * Returns a string on failure (LangChain tools must resolve to a string) or null
 * on success. The model can never widen scope.
 */
async function guardClient(
  ctx: ForgeToolContext["ctx"],
  clientId: string,
): Promise<string | null> {
  try {
    await assertClientReadable(ctx, clientId);
  } catch (err) {
    if (err instanceof ForbiddenScopeError) {
      return "You are not authorized to read that client (scope mismatch).";
    }
    return "Couldn't verify access to that client right now. Please try again.";
  }
  return null;
}

/** Sum totalTax across a projection, guarding the optional taxResult. */
function sumTax(projection: ProjectionYear[]): number {
  return projection.reduce((s, y) => s + (y.taxResult?.flow.totalTax ?? 0), 0);
}

/** Sum Medicare total annual cost across a projection, guarding the optional. */
function sumMedicare(projection: ProjectionYear[]): number {
  return projection.reduce((s, y) => s + (y.medicare?.totalAnnualCost ?? 0), 0);
}

/** Flatten one hypothetical-estate-tax ordering to its headline totals. */
function orderingTotals(o: HypotheticalEstateTaxOrdering | undefined) {
  if (!o) return null;
  return {
    firstDecedent: o.firstDecedent,
    federal: o.totals.federal,
    state: o.totals.state,
    admin: o.totals.admin,
    total: o.totals.total,
  };
}

// Mirrors SolveLeverKey (src/lib/solver/solve-types.ts). z.discriminatedUnion
// gives the model a clear menu of solvable levers.
const SOLVE_LEVER_SCHEMA = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("retirement-age"), person: z.enum(["client", "spouse"]) }),
  z.object({ kind: z.literal("living-expense-scale") }),
  z.object({ kind: z.literal("savings-contribution"), accountId: z.string() }),
  z.object({ kind: z.literal("ss-claim-age"), person: z.enum(["client", "spouse"]) }),
  z.object({ kind: z.literal("roth-conversion-amount"), techniqueId: z.string() }),
]);

export function buildWhatIfTools(toolCtx: ForgeToolContext): StructuredToolInterface[] {
  const { ctx } = toolCtx;

  const whatifRoth = tool(
    async ({ clientId, scenarioId, conversions }) => {
      const denied = await guardClient(ctx, clientId);
      if (denied) return denied;

      const { effectiveTree } = await loadEffectiveTree(clientId, ctx.firmId, scenarioId, {});

      // Base projection: the plan as-is (no extra conversions).
      const baseProjection = runProjection(effectiveTree);

      // Scenario projection: upsert each candidate conversion via the solver
      // mutation that apply-mutations.ts handles (roth-conversion-upsert).
      // Each tool-input conversion is a single-year fixed-amount conversion, so
      // it maps onto the engine's RothConversion shape (startYear=endYear=year,
      // conversionType="fixed_amount", sourceAccountIds=[the one source]).
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
      const scenarioTree = applyMutations(effectiveTree, mutations);
      const scenarioProjection = runProjection(scenarioTree);

      // Per-year conversion gross/taxable (engine-reported, not invented).
      const conversionYears = scenarioProjection
        .filter((y) => (y.rothConversions?.length ?? 0) > 0)
        .map((y) => ({
          year: y.year,
          conversions: (y.rothConversions ?? []).map((rc) => ({
            id: rc.id,
            name: rc.name,
            gross: rc.gross,
            taxable: rc.taxable,
          })),
        }));

      const baseTax = sumTax(baseProjection);
      const scenarioTax = sumTax(scenarioProjection);
      const baseMedicare = sumMedicare(baseProjection);
      const scenarioMedicare = sumMedicare(scenarioProjection);

      return JSON.stringify({
        scenarioId,
        conversionYears,
        totals: {
          baseTax,
          scenarioTax,
          taxDelta: scenarioTax - baseTax,
          baseMedicare,
          scenarioMedicare,
          medicareDelta: scenarioMedicare - baseMedicare,
        },
        disclaimer:
          "Deltas are combined Base->Scenario lifetime totals; do not attribute a dollar amount to any single conversion.",
      });
    },
    {
      name: "whatif_roth",
      description:
        "Model one or more Roth conversions as a read-only what-if on a scenario. " +
        "Returns the per-year converted gross/taxable amounts the engine reports plus " +
        "the combined Base->Scenario lifetime tax and Medicare deltas. " +
        "For 'optimize conversions to hit a probability-of-success target' use solve_goal instead.",
      schema: z.object({
        clientId: z.string().describe("the client uuid (must match your scope)"),
        scenarioId: z
          .string()
          .describe("scenario uuid, or 'base' for the base case"),
        conversions: z
          .array(
            z.object({
              id: z.string().describe("stable id for this conversion (any unique string)"),
              name: z.string().optional().describe("display name; defaults to 'Roth conversion <year>'"),
              year: z.number().int().describe("calendar year of the conversion"),
              amount: z.number().describe("gross dollars converted that year"),
              sourceAccountId: z.string().describe("traditional/pre-tax account uuid drained"),
              destinationAccountId: z.string().describe("Roth account uuid funded"),
            }),
          )
          .describe("the candidate conversions to model"),
      }),
    },
  );

  const whatifSocialSecurity = tool(
    async ({ clientId, scenarioId, person }) => {
      const denied = await guardClient(ctx, clientId);
      if (denied) return denied;

      const { effectiveTree, resolutionContext } = await loadEffectiveTree(
        clientId,
        ctx.firmId,
        scenarioId,
        {},
      );

      // Deterministic argmax over claim ages 62-70 on the straight-line
      // projection. No Monte Carlo -> no seed, no PoS. resolutionContext lets
      // technique reinvestments re-resolve (mirrors the solver route).
      const result = solveSsClaimAgeByPortfolio({
        effectiveTree,
        baselineMutations: [],
        person: person as SolverPerson,
        resolutionContext,
      });

      return JSON.stringify({
        scenarioId,
        person,
        bestClaimAge: result.solvedValue,
        bestEndingPortfolio: result.endingPortfolio,
        candidates: result.candidates.map((c) => ({
          claimAge: c.value,
          endingPortfolio: c.endingPortfolio,
        })),
        method:
          "Deterministic: each candidate age is run once on the straight-line projection; " +
          "the winner maximizes final-year liquid portfolio (ties break toward the earliest age).",
      });
    },
    {
      name: "whatif_social_security",
      description:
        "Find the Social Security claim age (62-70) that maximizes the final-year liquid " +
        "portfolio for one household member. Deterministic (no Monte Carlo). Returns the best " +
        "age and the full candidate table so you can show the trade-off.",
      schema: z.object({
        clientId: z.string().describe("the client uuid (must match your scope)"),
        scenarioId: z.string().describe("scenario uuid, or 'base'"),
        person: z
          .enum(["client", "spouse"])
          .describe("which household member's claim age to solve"),
      }),
    },
  );

  const whatifWithdrawal = tool(
    async ({ clientId, scenarioId, withdrawalStrategy }) => {
      const denied = await guardClient(ctx, clientId);
      if (denied) return denied;

      const { effectiveTree } = await loadEffectiveTree(clientId, ctx.firmId, scenarioId, {});

      const baseProjection = runProjection(effectiveTree);
      const fromStrategy = effectiveTree.withdrawalStrategy;

      // withdrawal_strategy is a singleton TargetKind: an edit change whose
      // payload is the {field:{from,to}} map the engine's applyEdit consumes.
      const change: ScenarioChange = {
        id: "forge-whatif-withdrawal",
        scenarioId: "forge-whatif",
        opType: "edit",
        targetKind: "withdrawal_strategy",
        targetId: "withdrawal_strategy",
        payload: {
          withdrawalStrategy: { from: fromStrategy, to: withdrawalStrategy },
        },
        toggleGroupId: null,
        orderIndex: 0,
      };
      const { effectiveTree: scenarioTree } = applyScenarioChanges(
        effectiveTree,
        [change],
        {},
        [],
      );
      const scenarioProjection = runProjection(scenarioTree);

      const baseTax = sumTax(baseProjection);
      const scenarioTax = sumTax(scenarioProjection);
      const baseEndingPortfolio =
        baseProjection[baseProjection.length - 1]?.portfolioAssets.liquidTotal ?? 0;
      const scenarioEndingPortfolio =
        scenarioProjection[scenarioProjection.length - 1]?.portfolioAssets.liquidTotal ?? 0;

      return JSON.stringify({
        scenarioId,
        baseStrategy: fromStrategy,
        scenarioStrategy: withdrawalStrategy,
        totals: {
          baseTax,
          scenarioTax,
          taxDelta: scenarioTax - baseTax,
          baseEndingPortfolio,
          scenarioEndingPortfolio,
          endingPortfolioDelta: scenarioEndingPortfolio - baseEndingPortfolio,
        },
        disclaimer:
          "Deltas are combined Base->Scenario lifetime totals; observations only, not advice.",
      });
    },
    {
      name: "whatif_withdrawal",
      description:
        "Model a different withdrawal-order (the sequence accounts are drained in retirement) " +
        "as a read-only what-if. Provide the full ordered list of withdrawal buckets. Returns " +
        "the combined Base->Scenario lifetime tax and final-year liquid-portfolio deltas. " +
        "For 'how much can they sustainably spend' use solve_max_spending.",
      schema: z.object({
        clientId: z.string().describe("the client uuid (must match your scope)"),
        scenarioId: z.string().describe("scenario uuid, or 'base'"),
        withdrawalStrategy: z
          .array(z.string())
          .describe(
            "the full ordered list of withdrawal buckets (e.g. ['taxable','tax_deferred','tax_free']); " +
              "first item is drained first",
          ),
      }),
    },
  );

  const whatifEstateTax = tool(
    async ({ clientId, scenarioId, dieInYear }) => {
      const denied = await guardClient(ctx, clientId);
      if (denied) return denied;

      const { effectiveTree } = await loadEffectiveTree(clientId, ctx.firmId, scenarioId, {});
      const result = runProjectionWithEvents(effectiveTree);

      // Die-in-year-N: read that projection year's EoY hypothetical estate tax
      // (computed by the engine via computeHypotheticalEstateTax per year).
      if (dieInYear != null) {
        const row = result.years.find((y) => y.year === dieInYear);
        if (!row) {
          return JSON.stringify({
            error: `No projection year ${dieInYear} (plan horizon does not reach it).`,
          });
        }
        return JSON.stringify({
          scenarioId,
          dieInYear,
          hypotheticalEstateTax: {
            year: row.hypotheticalEstateTax.year,
            primaryFirst: orderingTotals(row.hypotheticalEstateTax.primaryFirst),
            spouseFirst: orderingTotals(row.hypotheticalEstateTax.spouseFirst),
          },
          disclaimer:
            "Hypothetical end-of-year estate tax if both principals died in this year; observations only.",
        });
      }

      // Default mode: the projected first/second death events + today's snapshot.
      return JSON.stringify({
        scenarioId,
        firstDeath: result.firstDeathEvent
          ? {
              year: result.firstDeathEvent.year,
              deceased: result.firstDeathEvent.deceased,
              totalTaxesAndExpenses: result.firstDeathEvent.totalTaxesAndExpenses,
              federalEstateTax: result.firstDeathEvent.federalEstateTax,
              stateEstateTax: result.firstDeathEvent.stateEstateTax,
            }
          : null,
        secondDeath: result.secondDeathEvent
          ? {
              year: result.secondDeathEvent.year,
              deceased: result.secondDeathEvent.deceased,
              totalTaxesAndExpenses: result.secondDeathEvent.totalTaxesAndExpenses,
              federalEstateTax: result.secondDeathEvent.federalEstateTax,
              stateEstateTax: result.secondDeathEvent.stateEstateTax,
            }
          : null,
        today: {
          year: result.todayHypotheticalEstateTax.year,
          primaryFirst: orderingTotals(result.todayHypotheticalEstateTax.primaryFirst),
          spouseFirst: orderingTotals(result.todayHypotheticalEstateTax.spouseFirst),
        },
        disclaimer:
          "Estate-tax figures are engine-computed for the projected death years; observations only, not advice.",
      });
    },
    {
      name: "whatif_estate_tax",
      description:
        "Report a scenario's estate-tax exposure. Default: the projected first- and second-death " +
        "estate-tax events plus the 'as of today' hypothetical (both principals die now), with " +
        "client-first and spouse-first orderings. Pass dieInYear to read the hypothetical estate " +
        "tax if both principals died in a specific future year.",
      schema: z.object({
        clientId: z.string().describe("the client uuid (must match your scope)"),
        scenarioId: z.string().describe("scenario uuid, or 'base'"),
        dieInYear: z
          .number()
          .int()
          .optional()
          .describe("optional: a future calendar year for the 'die in year N' hypothetical"),
      }),
    },
  );

  const whatifLifeInsuranceNeed = tool(
    async ({
      clientId,
      scenarioId,
      deceased,
      deathYear,
      targetSurvivorPortfolio,
      proceedsGrowthRate,
      livingExpenseAtDeath,
      payoffLiabilityIds,
    }) => {
      const denied = await guardClient(ctx, clientId);
      if (denied) return denied;

      const { effectiveTree } = await loadEffectiveTree(clientId, ctx.firmId, scenarioId, {});

      const target = targetSurvivorPortfolio ?? 0;
      // Survivor ending portfolio rises monotonically with face value, so a
      // simple bisection over [0, $5M] converges. Deterministic engine runs
      // (no Monte Carlo) → repeatable. $10k tolerance, capped iterations.
      const LO_INIT = 0;
      const HI_INIT = 5_000_000;
      const TOLERANCE = 10_000;
      const MAX_ITERATIONS = 24;

      const evaluate = (faceValue: number): number => {
        const projection = runLifeInsuranceWhatIf({
          data: effectiveTree,
          deceased: deceased as "client" | "spouse",
          deathYear,
          faceValue,
          proceedsGrowthRate: proceedsGrowthRate ?? effectiveTree.planSettings?.inflationRate ?? 0,
          livingExpenseAtDeath: livingExpenseAtDeath ?? null,
          payoffLiabilityIds: payoffLiabilityIds ?? [],
        });
        return survivorEndingPortfolio(projection, deceased as "client" | "spouse", effectiveTree);
      };

      let lo = LO_INIT;
      let hi = HI_INIT;
      const hiEnding = evaluate(hi);
      let status: "converged" | "unreachable" = "converged";
      if (hiEnding < target) {
        // Even max coverage can't clear the target — report the ceiling.
        status = "unreachable";
        lo = hi;
      } else {
        for (let i = 0; i < MAX_ITERATIONS && hi - lo > TOLERANCE; i += 1) {
          const mid = (lo + hi) / 2;
          if (evaluate(mid) >= target) {
            hi = mid;
          } else {
            lo = mid;
          }
        }
      }

      const solvedFaceValue = Math.ceil(hi / TOLERANCE) * TOLERANCE;
      const solvedSurvivorPortfolio = evaluate(solvedFaceValue);

      return JSON.stringify({
        scenarioId,
        deceased,
        deathYear,
        status,
        targetSurvivorPortfolio: target,
        solvedFaceValue,
        solvedSurvivorPortfolio,
        disclaimer:
          "Smallest term face value (to $10k) whose deterministic projection leaves the survivor " +
          "at or above the target ending portfolio. Observations only, not advice.",
      });
    },
    {
      name: "whatif_life_insurance_need",
      description:
        "Solve how much term life-insurance coverage the household needs. Bisects candidate face " +
        "values for a premature death of one principal in deathYear, returning the smallest face " +
        "value whose deterministic projection leaves the survivor's ending portfolio at or above " +
        "targetSurvivorPortfolio (default $0 = does not run out).",
      schema: z.object({
        clientId: z.string().describe("the client uuid (must match your scope)"),
        scenarioId: z.string().describe("scenario uuid, or 'base'"),
        deceased: z.enum(["client", "spouse"]).describe("which principal dies prematurely"),
        deathYear: z.number().int().describe("calendar year of the premature death"),
        targetSurvivorPortfolio: z
          .number()
          .optional()
          .describe("survivor's required final-year liquid portfolio; default 0"),
        proceedsGrowthRate: z
          .number()
          .optional()
          .describe("blended growth rate on the proceeds; default = plan inflation rate"),
        livingExpenseAtDeath: z
          .number()
          .optional()
          .describe("survivor's annual living expense after the death; default = unchanged"),
        payoffLiabilityIds: z
          .array(z.string())
          .optional()
          .describe("household liability uuids retired at the insured's death"),
      }),
    },
  );

  const solveGoal = tool(
    async ({ clientId, scenarioId, target, targetPoS }) => {
      const denied = await guardClient(ctx, clientId);
      if (denied) return denied;

      const { effectiveTree, resolutionContext } = await loadEffectiveTree(
        clientId,
        ctx.firmId,
        scenarioId,
        {},
      );
      // Reuse the persisted per-scenario MC seed so the solve is reproducible.
      const mcPayload = await loadMonteCarloData(clientId, ctx.firmId, scenarioId);

      // PoS levers always resolve to the PoS branch of SolveResultEvent.
      const result = (await solveTarget({
        effectiveTree,
        mcPayload,
        baselineMutations: [],
        target: target as SolveLeverKey,
        targetPoS,
        resolutionContext,
      })) as PoSSolveResult;

      const endingPortfolio =
        result.finalProjection[result.finalProjection.length - 1]?.portfolioAssets.liquidTotal ??
        null;

      return JSON.stringify({
        scenarioId,
        target,
        targetPoS,
        status: result.status,
        solvedValue: result.solvedValue,
        achievedPoS: result.achievedPoS, // 250-trial PoS at the solved value
        canonicalPoS: result.canonicalPoS, // == achievedPoS (solve runs at 250 trials)
        reportedPoS: result.canonicalPoS, // headline PoS
        seed: result.seed,
        endingPortfolio,
        disclaimer:
          "reportedPoS is the 250-trial probability of success at the solved lever value. " +
          "Observations only, not advice.",
      });
    },
    {
      name: "solve_goal",
      description:
        "Goal-seek a single lever to hit a Monte-Carlo probability-of-success target. Levers: " +
        "retirement-age, living-expense-scale, savings-contribution, ss-claim-age, " +
        "roth-conversion-amount. Returns the solved lever value and the 250-trial PoS " +
        "(reportedPoS). Reuses the scenario's persisted seed so the result is reproducible.",
      schema: z.object({
        clientId: z.string().describe("the client uuid (must match your scope)"),
        scenarioId: z.string().describe("scenario uuid, or 'base'"),
        target: SOLVE_LEVER_SCHEMA.describe("which lever to solve and its parameters"),
        targetPoS: z
          .number()
          .min(0.01)
          .max(0.99)
          .describe("target probability of success, e.g. 0.85"),
      }),
    },
  );

  const solveMaxSpendingTool = tool(
    async ({ clientId, scenarioId, targetPoS }) => {
      const denied = await guardClient(ctx, clientId);
      if (denied) return denied;

      const { effectiveTree } = await loadEffectiveTree(clientId, ctx.firmId, scenarioId, {});
      // Reuse the persisted per-scenario MC seed for reproducibility.
      const mcPayload = await loadMonteCarloData(clientId, ctx.firmId, scenarioId);

      const result = await solveMaxSpending({
        tree: effectiveTree,
        mcPayload,
        targetPoS,
      });

      return JSON.stringify({
        scenarioId,
        targetPoS,
        status: result.status,
        realAnnualSpend: result.realAnnualSpend, // today's dollars, rounded to $5k
        scaleFactor: result.scaleFactor,
        achievedPoS: result.achievedPoS, // 250-trial PoS at the solved spend
        disclaimer:
          "realAnnualSpend is the maximum sustainable retirement spend (today's dollars, rounded " +
          "to $5k) whose probability of success lands closest to the target. Observations only, not advice.",
      });
    },
    {
      name: "solve_max_spending",
      description:
        "Find the maximum sustainable annual retirement spending (today's dollars, rounded to $5k) " +
        "whose Monte-Carlo probability of success lands closest to a target. Reuses the scenario's " +
        "persisted seed and reports the 250-trial achieved PoS.",
      schema: z.object({
        clientId: z.string().describe("the client uuid (must match your scope)"),
        scenarioId: z.string().describe("scenario uuid, or 'base'"),
        targetPoS: z
          .number()
          .min(0.01)
          .max(0.99)
          .describe("target probability of success, e.g. 0.85"),
      }),
    },
  );

  return [
    whatifRoth,
    whatifSocialSecurity,
    whatifWithdrawal,
    whatifEstateTax,
    whatifLifeInsuranceNeed,
    solveGoal,
    solveMaxSpendingTool,
  ];
}
