import { db } from "@/db";
import { scenarioComputeCache } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { resolveScenarioId } from "./resolve-scenario-id";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { runProjectionWithEvents } from "@/engine/projection";
import {
  runMonteCarlo,
  createReturnEngine,
  type MonteCarloResult,
} from "@/engine";
import { buildMonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/build-payload";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import { hashMonteCarloInputs, ENGINE_VERSION } from "./hash";
import { annualIncomeAtStart } from "@/lib/monte-carlo/annual-income";

export interface CachedMonteCarloResult {
  payload: MonteCarloReportPayload;
  raw: MonteCarloResult;
  meta: {
    requiredMinimumAssetLevel: number;
    startingLiquidBalance: number;
    planStartYear: number;
    clientBirthYear: number | undefined;
    clientDisplayName: string;
    annualIncomeAtStart: number;
    retirementAge: number;
    spouseRetirementAge: number | undefined;
  };
}

const CANONICAL_TRIALS = 1000;

export async function getOrComputeMonteCarlo(args: {
  clientId: string;
  firmId: string;
  scenarioId: string | "base";
  trials?: number;
  forceRefresh?: boolean;
}): Promise<CachedMonteCarloResult> {
  const trials = args.trials ?? CANONICAL_TRIALS;
  const realScenarioId = await resolveScenarioId(args.clientId, args.scenarioId);

  const { effectiveTree } = await loadEffectiveTree(
    args.clientId,
    args.firmId,
    args.scenarioId,
    {},
  );
  // Pass the effective tree so startingLiquidBalance + the in-estate liquid
  // account set follow this scenario (Depth 1), mirroring the export-pdf route.
  const mcPayload = await loadMonteCarloData(
    args.clientId,
    args.firmId,
    args.scenarioId,
    [],
    effectiveTree,
  );

  const inputHash = hashMonteCarloInputs({ tree: effectiveTree, mcPayload, trials });

  if (!args.forceRefresh) {
    try {
      const [row] = await db
        .select()
        .from(scenarioComputeCache)
        .where(
          and(
            eq(scenarioComputeCache.scenarioId, realScenarioId),
            eq(scenarioComputeCache.kind, "monte_carlo"),
          ),
        );
      if (row && row.inputHash === inputHash) {
        return row.payload as CachedMonteCarloResult;
      }
    } catch (err) {
      console.error("scenario_compute_cache read failed; recomputing", err);
    }
  }

  const start = Date.now();
  const projection = runProjectionWithEvents(effectiveTree);
  const engine = createReturnEngine({
    indices: mcPayload.indices,
    correlation: mcPayload.correlation,
    seed: mcPayload.seed,
  });
  const accountMixes = new Map(
    mcPayload.accountMixes.map((a) => [a.accountId, a.mix]),
  );
  const raw = await runMonteCarlo({
    data: effectiveTree,
    returnEngine: engine,
    accountMixes,
    trials,
    requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
  });
  const payload = buildMonteCarloReportPayload({
    result: raw,
    projection,
    mcPayload,
    clientData: effectiveTree,
  });
  const clientBirthYear = effectiveTree.client.dateOfBirth
    ? parseInt(effectiveTree.client.dateOfBirth.slice(0, 4), 10) || undefined
    : undefined;
  const planStartYear = projection.years[0]?.year ?? new Date().getFullYear();
  // Mirror ReportHeader's display-name formatting (monte-carlo-report.tsx).
  const client = effectiveTree.client;
  const clientDisplayName = client.spouseName
    ? `${client.firstName} & ${client.spouseName} ${client.lastName}`
    : `${client.firstName} ${client.lastName}`;
  const cached: CachedMonteCarloResult = {
    payload,
    raw,
    meta: {
      requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
      startingLiquidBalance: mcPayload.startingLiquidBalance,
      planStartYear,
      clientBirthYear,
      clientDisplayName,
      annualIncomeAtStart: annualIncomeAtStart(effectiveTree, planStartYear),
      retirementAge: effectiveTree.client.retirementAge,
      spouseRetirementAge: effectiveTree.client.spouseRetirementAge,
    },
  };
  const computeMs = Date.now() - start;

  try {
    await db
      .insert(scenarioComputeCache)
      .values({
        firmId: args.firmId,
        clientId: args.clientId,
        scenarioId: realScenarioId,
        kind: "monte_carlo",
        inputHash,
        trials,
        engineVersion: ENGINE_VERSION,
        payload: cached,
        computeMs,
      })
      .onConflictDoUpdate({
        target: [scenarioComputeCache.scenarioId, scenarioComputeCache.kind],
        set: {
          inputHash,
          trials,
          engineVersion: ENGINE_VERSION,
          payload: cached,
          computeMs,
          computedAt: new Date(),
        },
      });
  } catch (err) {
    console.error("scenario_compute_cache write failed; returning fresh result", err);
  }

  return cached;
}
