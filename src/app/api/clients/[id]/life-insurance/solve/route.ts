// src/app/api/clients/[id]/life-insurance/solve/route.ts
//
// POST /api/clients/[id]/life-insurance/solve
//
// Straight-line Life Insurance need solver. Reads the client's effective
// base-plan tree and runs the bisection solver for the client-death case
// (and the spouse-death case for married households). Pure COMPUTE route —
// reads the client tree, runs projections, never mutates the database.
// Allowlisted in the active-subscription lint for parity with solver/solve.
import { NextRequest, NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { findClientInFirm } from "@/lib/db-scoping";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  solveLifeInsuranceNeed,
  type LifeInsuranceAssumptions,
} from "@/lib/life-insurance/solve-need";
import { runLifeInsuranceWhatIf } from "@/engine/what-if/life-insurance-need";
import { loadLiProceedsGrowth } from "@/lib/life-insurance/load-li-portfolio";
import { existingCoverageInForce } from "@/lib/life-insurance/existing-coverage";
import { LI_ASSUMPTIONS_SCHEMA } from "@/lib/life-insurance/schema";
import type { ClientData } from "@/engine/types";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ id: string }> };

/** Default flat LI-proceeds growth when no model portfolio is selected. */
const DEFAULT_LI_GROWTH = 0.05;

/** Solve one decedent's need + survivor projection + existing-coverage breakdown. */
function solveCase(
  tree: ClientData,
  deceased: "client" | "spouse",
  a: LifeInsuranceAssumptions,
) {
  const need = solveLifeInsuranceNeed(tree, deceased, a);
  const projection = runLifeInsuranceWhatIf({
    data: tree,
    deceased,
    deathYear: a.deathYear,
    faceValue: need.faceValue,
    proceedsGrowthRate: a.proceedsGrowthRate,
    proceedsRealization: a.proceedsRealization,
    livingExpenseAtDeath: a.livingExpenseAtDeath,
    payoffLiabilityIds: a.payoffLiabilityIds,
  });
  const coverage = existingCoverageInForce(tree, deceased, a.deathYear);
  return {
    ...need,
    projection,
    existingPolicies: coverage.policies,
    existingCoverageTotal: coverage.total,
  };
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId } = await ctx.params;

    const inFirm = await findClientInFirm(clientId, firmId);
    if (!inFirm) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const parsed = LI_ASSUMPTIONS_SCHEMA.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const { effectiveTree } = await loadEffectiveTree(clientId, firmId, "base", {});

    const proceeds = await loadLiProceedsGrowth(
      firmId,
      body.modelPortfolioId,
      DEFAULT_LI_GROWTH,
    );
    const a: LifeInsuranceAssumptions = {
      deathYear: body.deathYear,
      proceedsGrowthRate: proceeds.rate,
      proceedsRealization: proceeds.realization,
      leaveToHeirsAmount: body.leaveToHeirsAmount,
      livingExpenseAtDeath: body.livingExpenseAtDeath,
      payoffLiabilityIds: body.payoffLiabilityIds,
    };

    const filingStatus = effectiveTree.client.filingStatus;
    const isMarried =
      filingStatus === "married_joint" || filingStatus === "married_separate";

    const client = solveCase(effectiveTree, "client", a);
    const spouse = isMarried ? solveCase(effectiveTree, "spouse", a) : null;

    return NextResponse.json({ isMarried, client, spouse });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error(
      "POST /api/clients/[id]/life-insurance/solve error:",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
