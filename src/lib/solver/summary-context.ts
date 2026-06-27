// src/lib/solver/summary-context.ts
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear, ProjectionResult, ClientData } from "@/engine";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import type { LifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";

export interface SolverSummaryContextInput {
  years: ProjectionYear[];
  clientData: ClientData;
  clientName: string;
  spouseName: string | null;
  /** Working Monte Carlo success rate [0,1], or null if not yet run. */
  mcSuccessRate: number | null;
  /** Label shown in summary titles/subtitles. */
  scenarioLabel?: string;
  /** Full projection — required only by the Estate summary; injected when loaded. */
  fullProjection?: ProjectionResult;
  /** DB-loaded inventory — required only by the Life Insurance summary. */
  lifeInsurance?: LifeInsuranceInventory;
}

/**
 * Assembles the subset of BuildDataContext the five summaries need from live
 * Solver state. Firm branding is stubbed: no summary `buildData` reads it
 * (it is PDF page-chrome only), and the live renderer draws no chrome.
 */
export function buildSolverSummaryContext(
  input: SolverSummaryContextInput,
): BuildDataContext {
  const {
    years, clientData, clientName, spouseName, mcSuccessRate,
    scenarioLabel = "Proposed", fullProjection, lifeInsurance,
  } = input;

  // The retirement builder reads only `monteCarlo?.summary.successRate`.
  const monteCarlo: MonteCarloReportPayload | null =
    mcSuccessRate == null
      ? null
      : ({ summary: { successRate: mcSuccessRate } } as unknown as MonteCarloReportPayload);

  return {
    years,
    // Only the Estate summary reads `projection` deeply, and its view renders
    // only once `fullProjection` has loaded — so the stub is never read.
    projection: fullProjection ?? ({ years } as ProjectionResult),
    clientData,
    scenarioLabel,
    clientName,
    spouseName,
    firmName: "",
    firmTagline: null,
    reportDate: "",
    firmLogoDataUrl: null,
    accentColor: "#000000",
    monteCarlo,
    lifeInsurance,
  };
}
