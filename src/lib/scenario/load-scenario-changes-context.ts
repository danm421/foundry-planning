// src/lib/scenario/load-scenario-changes-context.ts
// The one assembly of a scenario's change set for anything that DESCRIBES the
// edits: the PDF export's Plan Comparison page and the Observations
// next-steps generator. Two callers, one implementation — the moment a second
// copy existed (the Retirement Comparison prompt's terse describer) the two
// disagreed about what a change was called.
//
// Org-scoping note: loadScenarioChanges / loadScenarioToggleGroups read by
// scenarioId alone. Every caller must have obtained `clientData` for this
// scenarioId through loadEffectiveTree / loadEffectiveTreeForRef, which load
// the scenario scoped to clientId/firmId and throw on a cross-org id. Do not
// call this with a scenarioId that has not been through one of them.
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";
import { loadScenarioChanges, loadScenarioToggleGroups } from "@/lib/scenario/changes";
import { buildTargetNames } from "@/lib/scenario/load-panel-data";
import {
  applyReinvestmentEnrichment,
  buildAssetTxResolveData,
  buildBaseResolveData,
  buildReinvestmentEnrichmentDeps,
  hasReinvestmentChange,
} from "@/lib/scenario/scenario-changes-resolve";
import type { InvestmentOptionCatalog } from "@/lib/presentations/investment-option-catalog";
import type { ScenarioChangesContext } from "@/lib/presentations/pages/scenario-changes/types";

export interface LoadScenarioChangesContextArgs {
  scenarioId: string;
  clientId: string;
  /** The scenario's EFFECTIVE tree — names resolve against it. */
  clientData: ClientData;
  /** The projection of that tree — asset-transaction figures come from it. */
  projection: ProjectionResult;
  /** Memoized by the caller (the export shares one memo across its passes). */
  getInvestmentCatalog: () => Promise<InvestmentOptionCatalog>;
  /** Prefixes the non-fatal console log. */
  logContext: string;
}

export async function loadScenarioChangesContext(
  args: LoadScenarioChangesContextArgs,
): Promise<ScenarioChangesContext> {
  const { scenarioId, clientId, clientData, projection, getInvestmentCatalog, logContext } = args;

  const [changes, toggleGroups] = await Promise.all([
    loadScenarioChanges(scenarioId),
    loadScenarioToggleGroups(scenarioId),
  ]);

  // Always build the base resolve maps (account / recipient / entity / spouse
  // names) off the effective tree — this is what makes transfer / savings /
  // roth / gift / will changes render rich references instead of terse
  // fallbacks.
  let resolve = buildBaseResolveData(clientData);

  // Reinvestment enrichment: surface the NEW model portfolio (name + resolved
  // growth rate) the switched accounts grow at. Gated on a reinvestment change
  // so the catalog query only loads when it can matter. Non-fatal: the
  // describer degrades to a blended-rate-only line.
  if (hasReinvestmentChange(changes)) {
    try {
      const catalog = await getInvestmentCatalog();
      const portfolioNamesById = Object.fromEntries(
        catalog.portfolios.map((p) => [p.id, p.name] as const),
      );
      resolve = applyReinvestmentEnrichment(
        resolve,
        buildReinvestmentEnrichmentDeps(changes, portfolioNamesById, clientData.reinvestments ?? []),
      );
    } catch (riErr) {
      console.error(`${logContext} reinvestment enrichment failed`, riErr);
    }
  }

  // Asset-transaction enrichment: projection-derived value bought/sold and net
  // cash received, keyed by transaction id. A pure reshape of the breakdown.
  resolve = { ...resolve, assetTxById: buildAssetTxResolveData(projection.years) };

  return {
    changes,
    toggleGroups,
    targetNames: buildTargetNames(clientData, clientId),
    baseLabel: "your current plan",
    resolve,
  };
}
