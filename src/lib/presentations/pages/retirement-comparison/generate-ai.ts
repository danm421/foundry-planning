// Server-side generator for the Retirement Comparison page's Markdown advisor
// commentary. Extracted from the retirement-comparison-ai route so the same
// projection → Monte Carlo → prompt → cache → LLM pipeline can run both
// interactively (the route) and as the final step of a background presentation
// run. Auth, rate limiting, and audit stay with the callers; this module is
// pure compute + the Redis-cached Azure call.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { loadEffectiveTreeForRef } from "@/lib/scenario/loader";
import { resolveScenarioRef } from "@/lib/scenario/presentation-refs";
import { runProjectionWithEvents } from "@/engine/projection";
import { runMonteCarlo, summarizeMonteCarlo, createReturnEngine } from "@/engine";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { buildTargetNames } from "@/lib/scenario/load-panel-data";
import { describeChangeUnit, type ChangeUnit } from "@/lib/scenario/scenario-change-describe";
import { buildRetirementComparisonMetrics } from "./metrics";
import { buildRetirementComparisonAiPrompt } from "./ai-prompt";
import { getOrComputeMaxSpending } from "@/lib/compute-cache/max-spending";
import { hashAiRequest, getCachedAnalysis, setCachedAnalysis } from "@/lib/presentations/ai-cache";
import { callAIExtraction } from "@/lib/extraction/azure-client";
import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";

export interface GenerateRetirementComparisonAiArgs {
  clientId: string;
  firmId: string;
  scenarioId: string;
  tone: "concise" | "detailed" | "plain";
  length: "short" | "medium" | "long";
  customInstructions: string;
  targetConfidence: number;
  /** Bypass the Redis cache and force a fresh LLM call. */
  force: boolean;
}

export interface GeneratedRetirementComparisonAi {
  markdown: string;
  generatedAt: string;
  /** SHA-256 of the assembled prompt — staleness hint for callers. */
  hash: string;
  /** True when served from the Redis cache (no LLM call made). */
  cached: boolean;
}

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

/**
 * Project both base + scenario, run their Monte Carlo + max-spend solves, build
 * the prompt, and return the LLM commentary. Reads through the Redis cache keyed
 * on the prompt hash unless `force` is set, so repeated runs on unchanged inputs
 * are free. Does NOT record audit or check rate limits — callers own those.
 */
export async function generateRetirementComparisonAi(
  args: GenerateRetirementComparisonAiArgs,
): Promise<GeneratedRetirementComparisonAi> {
  const { clientId, firmId } = args;

  const [base, scn] = await Promise.all([
    projectAndMc(clientId, firmId, "base"),
    projectAndMc(clientId, firmId, args.scenarioId),
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
    loadScenarioChanges(args.scenarioId),
    loadScenarioToggleGroups(args.scenarioId),
    resolveScenarioLabel(clientId, args.scenarioId),
    getOrComputeMaxSpending({ clientId, firmId, scenarioId: "base", targetPoS: args.targetConfidence }).catch(() => null),
    getOrComputeMaxSpending({ clientId, firmId, scenarioId: args.scenarioId, targetPoS: args.targetConfidence }).catch(() => null),
  ]);
  const targetNames = buildTargetNames(scn.effectiveTree, clientId);
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
    tone: args.tone,
    length: args.length,
    customInstructions: args.customInstructions,
    maxSpend,
    downside,
  });

  const hash = hashAiRequest({ system, user });
  if (!args.force) {
    const hit = await getCachedAnalysis(clientId, hash);
    if (hit) {
      return { markdown: hit.markdown, generatedAt: hit.generatedAt, cached: true, hash };
    }
  }

  // Pin gpt-5.4 explicitly rather than relying on the AZURE_ANALYSIS_MODEL
  // env override — matches the comparison-tool AI route for predictable output.
  const markdown = (await callAIExtraction(system, user, "gpt-5.4")).trim();
  const generatedAt = new Date().toISOString();

  await setCachedAnalysis(clientId, hash, { markdown, generatedAt });

  return { markdown, generatedAt, cached: false, hash };
}
