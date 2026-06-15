// src/domain/copilot/tools/whatif.ts
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { CopilotToolContext } from "../context";
import { assertClientReadable } from "../guards";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection, runProjectionWithEvents } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import type { SolverMutation, SolverPerson } from "@/lib/solver/types";
import type {
  RothConversion,
  ProjectionYear,
  HypotheticalEstateTaxOrdering,
} from "@/engine/types";
import { solveSsClaimAgeByPortfolio } from "@/lib/solver/solve-ss-portfolio";
import { applyScenarioChanges } from "@/engine/scenario/applyChanges";
import type { ScenarioChange } from "@/engine/scenario/types";

/**
 * Shared preamble for every what-if tool: the model-supplied clientId must equal
 * the server-derived ctx.clientId, and the bound client must pass the firm
 * tenant check — both enforced by assertClientReadable (the pinned scope guard).
 * Returns a string on failure (LangChain tools must resolve to a string) or null
 * on success. The model can never widen scope.
 */
async function guardClient(
  ctx: CopilotToolContext["ctx"],
  clientId: string,
): Promise<string | null> {
  try {
    await assertClientReadable(ctx, clientId);
  } catch {
    return "You are not authorized to read that client (scope mismatch).";
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

export function buildWhatIfTools(toolCtx: CopilotToolContext): StructuredToolInterface[] {
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
        id: "copilot-whatif-withdrawal",
        scenarioId: "copilot-whatif",
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

  return [whatifRoth, whatifSocialSecurity, whatifWithdrawal, whatifEstateTax];
}
