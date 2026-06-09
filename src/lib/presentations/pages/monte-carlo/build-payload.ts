import {
  summarizeMonteCarlo,
  liquidPortfolioTotal,
  type MonteCarloResult,
  type ProjectionResult,
} from "@/engine";
import { buildHistogramSeries } from "@/lib/monte-carlo/histogram-series";
import { successByYear } from "@/lib/monte-carlo/success-by-year";
import type { ClientData } from "@/engine/types";
import type { MonteCarloPayload } from "@/lib/projection/load-monte-carlo-data";
import type { MonteCarloReportPayload } from "./view-model";

/** Build the compact, serializable MC payload the presentation/report consume. */
export function buildMonteCarloReportPayload(args: {
  result: MonteCarloResult;
  projection: ProjectionResult;
  mcPayload: MonteCarloPayload;
  clientData: ClientData;
}): MonteCarloReportPayload {
  const { result, projection, mcPayload, clientData } = args;
  const summary = summarizeMonteCarlo(result, {
    client: clientData.client,
    planSettings: clientData.planSettings,
    startingLiquidBalance: mcPayload.startingLiquidBalance,
  });
  return {
    summary,
    histogram: buildHistogramSeries(result.endingLiquidAssets),
    successRates: successByYear(
      result.byYearLiquidAssetsPerTrial,
      mcPayload.requiredMinimumAssetLevel,
    ),
    deterministic: projection.years.map(liquidPortfolioTotal),
  };
}
