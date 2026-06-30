// src/lib/compute-cache/assemble-monte-carlo-result.ts
//
// Assembles the full CachedMonteCarloResult (payload + raw + meta) from a tree,
// its loaded MC inputs, the raw Monte Carlo result, and the deterministic
// projection. Extracted from getOrComputeMonteCarlo's compute closure so the
// solver's edited-tree path builds an identical payload.
import { buildMonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/build-payload";
import { annualIncomeAtStart } from "@/lib/monte-carlo/annual-income";
import type { ClientData, MonteCarloResult, ProjectionResult } from "@/engine";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { CachedMonteCarloResult } from "./monte-carlo";

export function assembleMonteCarloResult(args: {
  tree: ClientData;
  mcPayload: MonteCarloPayload;
  raw: MonteCarloResult;
  projection: ProjectionResult;
}): CachedMonteCarloResult {
  const { tree, mcPayload, raw, projection } = args;
  const payload = buildMonteCarloReportPayload({
    result: raw,
    projection,
    mcPayload,
    clientData: tree,
  });
  const clientBirthYear = tree.client.dateOfBirth
    ? parseInt(tree.client.dateOfBirth.slice(0, 4), 10) || undefined
    : undefined;
  const planStartYear = projection.years[0]?.year ?? new Date().getFullYear();
  const client = tree.client;
  const clientDisplayName = client.spouseName
    ? `${client.firstName} & ${client.spouseName} ${client.lastName}`
    : `${client.firstName} ${client.lastName}`;
  return {
    payload,
    raw,
    meta: {
      requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
      startingLiquidBalance: mcPayload.startingLiquidBalance,
      planStartYear,
      clientBirthYear,
      clientDisplayName,
      annualIncomeAtStart: annualIncomeAtStart(tree, planStartYear),
      retirementAge: client.retirementAge,
      spouseRetirementAge: client.spouseRetirementAge,
    },
  };
}
