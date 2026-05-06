// src/lib/reports/scopes/monteCarlo.ts
//
// Stub for v1. The real engine integration requires building accountMixes
// from CMA per-account allocations + sourcing a ReturnEngine — substantial
// plumbing tracked as future-work (engine.md → Foundry Reports v1
// follow-ups). Until that lands, this scope returns null
// `successProbability` and an empty `bands` array; the monteCarloFan widget
// renders a "—" headline and a "not yet available" placeholder.
//
// The real implementation will call `runMonteCarlo({ data, returnEngine,
// accountMixes, trials? })` and summarize `byYearLiquidAssetsPerTrial` into
// per-year p5/p25/p50/p75/p95 percentile rollups. Keeping the stub return
// shape stable means the widget code doesn't change when the wiring lands.

import { registerScope } from "@/lib/reports/scope-registry";

export type MonteCarloScopeData = {
  successProbability: number | null;
  bands: {
    year: number;
    p5: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
  }[];
};

registerScope({
  key: "monteCarlo",
  label: "Monte Carlo",
  fetch: (): MonteCarloScopeData => ({
    successProbability: null,
    bands: [],
  }),
  serializeForAI: (data) => {
    const d = data as MonteCarloScopeData;
    if (d.successProbability == null) {
      return "Monte Carlo: not yet wired (v1 stub).";
    }
    return `Monte Carlo success probability ${(d.successProbability * 100).toFixed(0)}% over ${d.bands.length} years.`;
  },
});
