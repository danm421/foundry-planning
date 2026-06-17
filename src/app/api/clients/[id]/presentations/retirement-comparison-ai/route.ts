// POST: generate Markdown advisor commentary for the Retirement Comparison
// presentation page. Mirrors comparison/ai-analysis: same Azure wrapper,
// firm-keyed extract rate limit, fail-closed posture, and a Redis cache keyed
// on the SHA-256 of the assembled prompt so repeated Generate clicks on
// unchanged inputs are free.

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { authErrorResponse } from "@/lib/authz";
import { checkExtractRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { loadEffectiveTreeForRef } from "@/lib/scenario/loader";
import { resolveScenarioRef } from "@/lib/scenario/presentation-refs";
import { runProjectionWithEvents } from "@/engine/projection";
import { runMonteCarlo, summarizeMonteCarlo, createReturnEngine } from "@/engine";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { buildTargetNames } from "@/lib/scenario/load-panel-data";
import { describeChangeUnit, type ChangeUnit } from "@/lib/scenario/scenario-change-describe";
import { buildRetirementComparisonMetrics } from "@/lib/presentations/pages/retirement-comparison/metrics";
import { buildRetirementComparisonAiPrompt } from "@/lib/presentations/pages/retirement-comparison/ai-prompt";
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";
import { hashAiRequest, getCachedAnalysis, setCachedAnalysis } from "@/lib/presentations/ai-cache";
import { callAIExtraction } from "@/lib/extraction/azure-client";
import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({
  scenarioId: z.string().min(1),
  tone: z.enum(["concise", "detailed", "plain"]),
  length: z.enum(["short", "medium", "long"]),
  customInstructions: z.string().max(2000).default(""),
  force: z.boolean().default(false),
  targetConfidence: z.number().min(0.5).max(0.99).default(0.85),
});

// Load the effective tree + deterministic projection for one ref, then run a
// 1000-trial Monte Carlo for its success rate. MC failures are non-fatal —
// successRate stays null and the page's KPI renders an em-dash. Mirrors the
// export route's MC loading pattern verbatim.
async function projectAndMc(clientId: string, firmId: string, raw: string) {
  const ref = resolveScenarioRef(raw);
  const { effectiveTree } = await loadEffectiveTreeForRef(clientId, firmId, ref);
  const projection = runProjectionWithEvents(effectiveTree);
  let successRate: number | null = null;
  let summary: ReturnType<typeof summarizeMonteCarlo> | null = null;
  try {
    const mc = await loadMonteCarloData(
      clientId,
      firmId,
      ref.kind === "scenario" ? ref.id : "base",
      [],
      effectiveTree,
    );
    const engine = createReturnEngine({
      indices: mc.indices,
      correlation: mc.correlation,
      seed: mc.seed,
    });
    const accountMixes = new Map(mc.accountMixes.map((a) => [a.accountId, a.mix]));
    const result = await runMonteCarlo({
      data: effectiveTree,
      returnEngine: engine,
      accountMixes,
      trials: 1000,
      requiredMinimumAssetLevel: mc.requiredMinimumAssetLevel,
    });
    summary = summarizeMonteCarlo(result, {
      client: effectiveTree.client,
      planSettings: effectiveTree.planSettings,
      startingLiquidBalance: mc.startingLiquidBalance,
    });
    successRate = summary.successRate;
  } catch (err) {
    console.error("retirement-comparison-ai MC failed", err);
  }
  return { effectiveTree, projection, successRate, summary };
}

// Group enabled changes the way the comparison tool does — singles stay loose,
// toggle-group members collapse into one "group" unit — then describe each.
function changeLinesFor(
  changes: ScenarioChange[],
  toggleGroups: ToggleGroup[],
  targetNames: Record<string, string>,
): string[] {
  // loadScenarioChanges already filters to enabled rows; describeChangeUnit
  // wants an explicit `enabled` flag on each change.
  const enabled = changes.map((c) => ({ ...c, enabled: true }));
  const groupNameById = new Map(toggleGroups.map((g) => [g.id, g.name]));
  const grouped = new Map<string, typeof enabled>();
  const singles: ChangeUnit[] = [];
  for (const c of enabled) {
    if (c.toggleGroupId) {
      const arr = grouped.get(c.toggleGroupId) ?? [];
      arr.push(c);
      grouped.set(c.toggleGroupId, arr);
    } else {
      singles.push({ kind: "single", change: c });
    }
  }
  const units: ChangeUnit[] = [
    ...singles,
    ...[...grouped.entries()].map(([gid, cs]) => ({
      kind: "group" as const,
      groupName: groupNameById.get(gid) ?? "Strategy",
      changes: cs,
    })),
  ];
  return units.map((u) => describeChangeUnit(u, targetNames));
}

// Human-readable label for the scenario being compared. Base resolves to a
// fixed literal; live scenarios read their name from the scenarios table
// (scoped to this client — firm ownership was already proven by the
// loadEffectiveTreeForRef call in projectAndMc). Snapshots and any unresolved
// id fall back to a sensible default.
async function resolveScenarioLabel(clientId: string, raw: string): Promise<string> {
  const ref = resolveScenarioRef(raw);
  if (ref.kind === "scenario") {
    if (ref.id === "base") return "Base Case";
    const [row] = await db
      .select({ name: scenarios.name })
      .from(scenarios)
      .where(and(eq(scenarios.id, ref.id), eq(scenarios.clientId, clientId)))
      .limit(1);
    return row?.name ?? "the scenario";
  }
  return "the scenario";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const parsed = Body.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const body = parsed.data;

    const rl = await checkExtractRateLimit(firmId);
    if (!rl.allowed) return rateLimitErrorResponse(rl, "AI analysis rate limit exceeded");

    const [base, scn] = await Promise.all([
      projectAndMc(id, firmId, "base"),
      projectAndMc(id, firmId, body.scenarioId),
    ]);

    const client = scn.effectiveTree.client;
    const retirementYear =
      new Date(client.dateOfBirth).getUTCFullYear() + client.retirementAge;

    const metrics = buildRetirementComparisonMetrics({
      baseYears: base.projection.years,
      scenarioYears: scn.projection.years,
      baseSuccess: base.successRate,
      scenarioSuccess: scn.successRate,
      retirementYear,
    });

    // Change descriptions and the (cold-cache-expensive) max-spend solves are
    // independent of each other, so resolve them in one parallel batch.
    const [changes, toggleGroups, scenarioLabel, baseMs, scnMs] = await Promise.all([
      loadScenarioChanges(body.scenarioId),
      loadScenarioToggleGroups(body.scenarioId),
      resolveScenarioLabel(id, body.scenarioId),
      getOrComputeMaxSpending({ clientId: id, firmId, scenarioId: "base", targetPoS: body.targetConfidence }).catch(() => null),
      getOrComputeMaxSpending({ clientId: id, firmId, scenarioId: body.scenarioId, targetPoS: body.targetConfidence }).catch(() => null),
    ]);
    const targetNames = buildTargetNames(scn.effectiveTree, id);
    const changeLines = changeLinesFor(changes, toggleGroups, targetNames);

    const firstName = client.firstName || "the household";
    const spouseFirst = client.spouseName ?? null;
    const firstNames = spouseFirst ? `${firstName} and ${spouseFirst}` : firstName;
    const householdName = `the ${client.lastName ?? firstName} household`;

    const maxSpend = baseMs && scnMs ? { base: baseMs.realAnnualSpend, scenario: scnMs.realAnnualSpend } : undefined;
    const downside = base.summary && scn.summary
      ? { baseEndP20: base.summary.ending.p20, scnEndP20: scn.summary.ending.p20 }
      : undefined;

    const { system, user } = buildRetirementComparisonAiPrompt({
      householdName,
      firstNames,
      scenarioLabel,
      kpis: metrics.kpis,
      matrix: metrics.matrix,
      changeLines,
      tone: body.tone,
      length: body.length,
      customInstructions: body.customInstructions,
      maxSpend,
      downside,
    });

    const hash = hashAiRequest({ system, user });
    if (!body.force) {
      const hit = await getCachedAnalysis(id, hash);
      if (hit) {
        return NextResponse.json({
          markdown: hit.markdown,
          generatedAt: hit.generatedAt,
          cached: true,
          hash,
        });
      }
    }

    // Pin gpt-5.4 explicitly rather than relying on the AZURE_ANALYSIS_MODEL
    // env override — matches the comparison-tool AI route for predictable output.
    const markdown = (await callAIExtraction(system, user, "gpt-5.4")).trim();
    const generatedAt = new Date().toISOString();

    await setCachedAnalysis(id, hash, { markdown, generatedAt });

    await recordAudit({
      // Reuse the existing AI-commentary action; the closed AuditAction union
      // has no retirement-comparison-specific value and we don't edit helpers
      // here. `surface` in metadata distinguishes it from the comparison tool.
      action: "comparison.ai_generate",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: {
        surface: "presentations.retirement_comparison",
        scenarioId: body.scenarioId,
        tone: body.tone,
        length: body.length,
        force: body.force,
      },
    });

    return NextResponse.json({ markdown, generatedAt, cached: false, hash });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: formatZodIssues(err) },
        { status: 400 },
      );
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST presentations/retirement-comparison-ai", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
