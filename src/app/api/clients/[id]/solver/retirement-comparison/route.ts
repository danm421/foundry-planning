// src/app/api/clients/[id]/solver/retirement-comparison/route.ts
//
// POST /api/clients/[id]/solver/retirement-comparison
//
// Assembles Base Case + working-tree bundles (projection + Monte Carlo +
// max-spend) and returns the built RetirementComparisonPageData. Run-button
// gated (heavy: 2 projections + 2 MC sims + max-spend solves) — never fired on
// edit. AI is always omitted.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runProjection } from "@/engine";
import type { ProjectionResult } from "@/engine";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { resolveTechniqueMutations } from "@/lib/solver/resolve-technique-mutations";
import type { SolverMutation } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { getOrComputeSolverMcReport } from "@/lib/compute-cache/solver-mc";
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";
import { solveMaxSpending } from "@/lib/solver/solve-max-spending";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { buildRetirementComparisonData } from "@/lib/presentations/pages/retirement-comparison/view-model";
import type { BuildDataContext } from "@/components/presentations/registry";
import type { PageScenarioBundle } from "@/components/presentations/document";
import { comparisonBundlesByRef, WORKING_SCENARIO_ID } from "@/lib/solver/comparison-bundles";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { checkProjectionRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MIX = z.object({
  accountId: z.string(),
  mix: z.array(z.object({ assetClassId: z.string(), weight: z.number() })),
});

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA),
  extraAccountMixes: z.array(MIX).optional(),
  targetConfidence: z.number().min(0.5).max(0.99).optional(),
  showPortfolioMatrix: z.boolean().optional(),
});

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const callerOrg = await requireOrgId();

    const rl = await checkProjectionRateLimit(callerOrg);
    if (!rl.allowed) {
      return rateLimitErrorResponse(rl, "Too many requests. Please wait a moment and try again.");
    }

    const { id: clientId } = await ctx.params;
    const access = await verifyClientAccess(clientId);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const firmId = access.firmId;

    const parsed = BODY.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
    }
    const { source, mutations, extraAccountMixes, showPortfolioMatrix } = parsed.data;
    const targetConfidence = parsed.data.targetConfidence ?? 0.85;
    const mixes = extraAccountMixes ?? [];

    // ── Base Case ──
    const { effectiveTree: baseTree } = await loadEffectiveTree(clientId, firmId, "base", {});
    const baseYears = runProjection(baseTree);

    // ── Working tree (source + live mutations) ──
    const { effectiveTree, resolutionContext } = await loadEffectiveTree(clientId, firmId, source, {});
    let workingTree = applyMutations(effectiveTree, mutations as SolverMutation[]);
    if (resolutionContext) {
      workingTree = resolveTechniqueMutations(workingTree, mutations as SolverMutation[], resolutionContext);
    }
    const workingYears = runProjection(workingTree);

    // ── Monte Carlo for both (working handles mutations via solver_mc_cache) ──
    const [baseMc, workingMc] = await Promise.all([
      getOrComputeSolverMcReport({ clientId, firmId, source: "base", mutations: [] }),
      getOrComputeSolverMcReport({ clientId, firmId, source, mutations: mutations as SolverMutation[], extraAccountMixes: mixes }),
    ]);

    // ── Max sustainable spend for both. Base uses the scenarioId cache; the
    // working (mutated) tree has no scenarioId, so solve it directly. ──
    const [baseMax, workingMax] = await Promise.all([
      getOrComputeMaxSpending({ clientId, firmId, scenarioId: "base", targetPoS: targetConfidence }),
      (async () => {
        const mcPayload = await loadMonteCarloData(clientId, firmId, source, mixes, workingTree);
        return solveMaxSpending({ tree: workingTree, mcPayload, targetPoS: targetConfidence, searchTrials: 250 });
      })(),
    ]);

    // ── Assemble bundles + build the view-model ──
    const baseBundle: PageScenarioBundle = {
      clientData: baseTree,
      projection: { years: baseYears } as ProjectionResult,
      scenarioLabel: "Base Case",
      monteCarlo: baseMc.payload,
      maxSpend: baseMax,
    };
    const workingBundle: PageScenarioBundle = {
      clientData: workingTree,
      projection: { years: workingYears } as ProjectionResult,
      scenarioLabel: "Proposed",
      monteCarlo: workingMc.payload,
      maxSpend: workingMax,
    };

    const buildCtx = {
      years: workingYears,
      projection: { years: workingYears } as ProjectionResult,
      clientData: workingTree,
      scenarioLabel: "Proposed",
      clientName: "",
      spouseName: null,
      firmName: "",
      firmTagline: null,
      reportDate: "",
      firmLogoDataUrl: null,
      accentColor: "var(--color-accent)",
      monteCarlo: workingMc.payload,
      bundlesByRef: comparisonBundlesByRef(baseBundle, workingBundle),
    } as BuildDataContext;

    const data = buildRetirementComparisonData(buildCtx, {
      scenarioId: WORKING_SCENARIO_ID,
      showPortfolioMatrix: showPortfolioMatrix ?? false,
      showAiSummary: false,
      showConfidenceRange: true,
      maxSpend: { show: true, targetConfidence },
      ai: { tone: "detailed", length: "medium", customInstructions: "", generatedText: "", generatedAt: null, sourceHash: null },
    });

    return NextResponse.json(data);
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/clients/[id]/solver/retirement-comparison error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
