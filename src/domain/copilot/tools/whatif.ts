// src/domain/copilot/tools/whatif.ts
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { CopilotToolContext } from "../context";
import { assertClientReadable } from "../guards";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import type { SolverMutation, SolverPerson } from "@/lib/solver/types";
import type { RothConversion, ProjectionYear } from "@/engine/types";
import { solveSsClaimAgeByPortfolio } from "@/lib/solver/solve-ss-portfolio";

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

  return [whatifRoth, whatifSocialSecurity];
}
