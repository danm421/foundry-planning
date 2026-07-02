// src/lib/solver/summary-context.ts
import type { BuildDataContext } from "@/components/presentations/registry";
import type { ProjectionYear, ProjectionResult, ClientData } from "@/engine";
import type { MonteCarloReportPayload } from "@/lib/presentations/pages/monte-carlo/view-model";
import type { LifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import { comparisonBundlesByRef } from "@/lib/solver/comparison-bundles";

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
  /** Base Case client data — enables the comparison summaries (base vs working). */
  baseClientData?: ClientData;
  /** Base Case projection years — enables the comparison summaries. */
  baseProjection?: ProjectionYear[];
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
    baseClientData, baseProjection,
  } = input;

  // The retirement builder reads only `monteCarlo?.summary.successRate`.
  const monteCarlo: MonteCarloReportPayload | null =
    mcSuccessRate == null
      ? null
      : ({ summary: { successRate: mcSuccessRate } } as unknown as MonteCarloReportPayload);

  // Comparison summaries (Tax Comparison) read `bundlesByRef`: Base Case vs the
  // live working tree. Deterministic-only — projection years are enough.
  const bundlesByRef =
    baseClientData && baseProjection
      ? comparisonBundlesByRef(
          {
            clientData: baseClientData,
            projection: { years: baseProjection } as ProjectionResult,
            scenarioLabel: "Base Case",
          },
          {
            clientData,
            projection: { years } as ProjectionResult,
            scenarioLabel,
          },
        )
      : undefined;

  return {
    years,
    // Only the Estate summary reads `projection` deeply, and its view renders
    // only once `fullProjection` has loaded — so the stub is never read.
    projection: fullProjection ?? ({ years } as ProjectionResult),
    clientData,
    scenarioLabel,
    clientName,
    spouseName,
    // No summary here renders the cover or Client Profile spouse card (the
    // surfaces that need the surname), so leave it unset.
    spouseLastName: null,
    firmName: "",
    firmTagline: null,
    reportDate: "",
    firmLogoDataUrl: null,
    // Branding stub — never read by any summary builder (the solver flow
    // renders summary views directly, not the PDF document chrome). Uses the
    // app accent token to satisfy brand/no-raw-hex.
    accentColor: "var(--color-accent)",
    monteCarlo,
    lifeInsurance,
    bundlesByRef,
  };
}
