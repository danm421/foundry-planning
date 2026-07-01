import { cache } from "react";
import type { MonteCarloResult } from "@/engine/monteCarlo/run";
import { runMonteCarlo } from "@/engine/monteCarlo/run";
import { createReturnEngine } from "@/engine/monteCarlo/returns";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import type { ToggleState } from "@/engine/scenario/types";
import { loadMonteCarloData } from "./load-monte-carlo-data";

export const getMonteCarloResult = cache(
  async (
    clientId: string,
    firmId: string,
    scenarioId: string | "base" = "base",
    toggleState: ToggleState = {},
  ): Promise<MonteCarloResult | null> => {
    try {
      const clientData = (
        await loadEffectiveTree(clientId, firmId, scenarioId, toggleState)
      ).effectiveTree;
      // Thread scenarioId for the ACTIVE scenario's own MC seed (F16), and the
      // effective tree so startingLiquidBalance is per-scenario (Depth 1).
      // Mixes/volatility/correlations stay base-sourced inside loadMonteCarloData.
      const mcPayload = await loadMonteCarloData(
        clientId,
        firmId,
        scenarioId,
        [],
        clientData,
      );
      const returnEngine = createReturnEngine({
        indices: mcPayload.indices,
        correlation: mcPayload.correlation,
        seed: mcPayload.seed,
      });
      const accountMixes = new Map(mcPayload.accountMixes.map((a) => [a.accountId, a.segments]));
      return await runMonteCarlo({
        data: clientData,
        returnEngine,
        accountMixes,
        requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
        trials: 1000,
      });
    } catch (err) {
      console.error(
        `[overview-pipeline] MC failed for clientId=${clientId}`,
        err,
      );
      return null;
    }
  },
);
