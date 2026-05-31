// src/app/api/clients/[id]/analysis/retirement/project/route.ts
//
// POST — deterministic recompute for the Explore column. Applies the supplied
// mutations to the effective tree, runs runProjection, returns years + summary.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runProjection } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import { deriveRetirementSummary } from "@/lib/analysis/derive-retirement-summary";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import type { SolverMutation } from "@/lib/solver/types";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  MIN_SAVINGS_GROWTH_SCHEMA,
  injectHypotheticalSavings,
} from "@/lib/analysis/inject-hypothetical-savings";

export const dynamic = "force-dynamic";

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
  /** Growth assumption for the hypothetical "Additional Taxable Savings" account.
   *  Lets an Explore edit of that lever grow at the picked portfolio rate.
   *  Defaults to the client's taxable category default when omitted. */
  minSavingsGrowth: MIN_SAVINGS_GROWTH_SCHEMA.optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await ctx.params;

    const inFirm = await findClientInFirm(clientId, firmId);
    if (!inFirm) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const parsed = BODY.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { source, mutations, minSavingsGrowth } = parsed.data;

    const { effectiveTree, resolutionContext } = await loadEffectiveTree(
      clientId,
      firmId,
      source,
      {},
    );
    // Inject the same synthetic "Additional Taxable Savings" account the /options
    // solve uses, BEFORE applyMutations — so an Explore savings-contribution on it
    // lands on a real rule and grows at the chosen rate. Inert (annualAmount 0)
    // when the advisor hasn't edited that lever.
    injectHypotheticalSavings(
      effectiveTree,
      minSavingsGrowth ?? { kind: "taxable-default" },
      resolutionContext,
    );
    let tree = applyMutations(effectiveTree, mutations as SolverMutation[]);
    if (resolutionContext) {
      tree = resolveTechniqueMutations(tree, mutations as SolverMutation[], resolutionContext);
    }
    const years = runProjection(tree);
    return NextResponse.json({ years, summary: deriveRetirementSummary(years) });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /analysis/retirement/project error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
