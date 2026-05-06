// src/lib/reports/scopes/comparison.ts
//
// Comparison scope: resolves two projections side-by-side and exposes
// the per-side scope payloads + headline delta math the Plan Comparison
// report needs.
//
// Split into two layers:
//
//   - `buildComparisonScopeData` — pure shaping function. Takes
//     pre-resolved projections + scope payloads for both sides and returns
//     `ComparisonScopeData`. Tested in `comparison.test.ts` with hand-built
//     fixtures; this is the only surface widget code depends on.
//
//   - `loadComparisonScope` — DB-touching wrapper. Loads two effective
//     scenario trees, runs two projections, fans out to the existing
//     scope loaders for each side, then calls `buildComparisonScopeData`.
//     Side-effect imports register the dependent scopes via the
//     barrel.
//
// We do NOT call `registerScope` here — `comparison` is a report-level
// binding (it depends on a `comparisonBinding` on the report row), not
// a per-widget scope key collected from the page tree. Widgets that need
// comparison data receive it through the data loader's binding-aware
// branch, not through the scope registry.

import { runProjection } from "@/engine/projection";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import type { ProjectionYear } from "@/engine/types";

import type { CashflowScopeData } from "./cashflow";
import type { BalanceScopeData } from "./balance";
import type { MonteCarloScopeData } from "./monteCarlo";
import type { AllocationScopeData } from "./allocation";
import { getScope } from "@/lib/reports/scope-registry";

import "./cashflow";
import "./balance";
import "./allocation";
import "./monteCarlo";

export type ComparisonSide = {
  cashflow:    CashflowScopeData;
  balance:     BalanceScopeData;
  monteCarlo:  MonteCarloScopeData;
  allocation:  AllocationScopeData;
};

export type ComparisonScopeData = {
  current:  ComparisonSide;
  proposed: ComparisonSide;
  delta: {
    successProbability: { current: number; proposed: number };
    portfolioAtEnd:     { current: number; proposed: number };
    netWorthAtEnd:      { current: number; proposed: number };
    lifetimeTaxes:      { current: number; proposed: number };
  };
};

type SideInput = {
  projection: ProjectionYear[];
  cashflow:   CashflowScopeData;
  balance:    BalanceScopeData;
  monteCarlo: MonteCarloScopeData;
  allocation: AllocationScopeData;
};

/** Pure shaping function — no IO. Computes the per-side payload object
 *  the comparison report widgets consume, plus headline delta fields
 *  pulled directly from each side's scope output. Null Monte Carlo
 *  probabilities (today's stub case) surface as `0` rather than crashing
 *  the report. */
export function buildComparisonScopeData(args: {
  current:  SideInput;
  proposed: SideInput;
}): ComparisonScopeData {
  const { current, proposed } = args;
  return {
    current: {
      cashflow:   current.cashflow,
      balance:    current.balance,
      monteCarlo: current.monteCarlo,
      allocation: current.allocation,
    },
    proposed: {
      cashflow:   proposed.cashflow,
      balance:    proposed.balance,
      monteCarlo: proposed.monteCarlo,
      allocation: proposed.allocation,
    },
    delta: {
      successProbability: {
        current:  current.monteCarlo.successProbability ?? 0,
        proposed: proposed.monteCarlo.successProbability ?? 0,
      },
      portfolioAtEnd: {
        current:  finalPortfolioTotal(current.projection),
        proposed: finalPortfolioTotal(proposed.projection),
      },
      netWorthAtEnd: {
        current:  finalNetWorth(current.balance),
        proposed: finalNetWorth(proposed.balance),
      },
      lifetimeTaxes: {
        current:  sumLifetimeTaxes(current.projection),
        proposed: sumLifetimeTaxes(proposed.projection),
      },
    },
  };
}

function finalPortfolioTotal(projection: ProjectionYear[]): number {
  if (projection.length === 0) return 0;
  return projection[projection.length - 1].portfolioAssets.total;
}

function finalNetWorth(balance: BalanceScopeData): number {
  if (balance.years.length === 0) return 0;
  return balance.years[balance.years.length - 1].netWorth;
}

function sumLifetimeTaxes(projection: ProjectionYear[]): number {
  let total = 0;
  for (const y of projection) total += y.expenses.taxes;
  return total;
}

/** Load both projections + every scope payload, then assemble the
 *  comparison data shape. Used by the report data loader when a report
 *  has a `comparisonBinding` set. The scope loaders are pulled directly
 *  from the registry so we reuse the same `fetch` logic the
 *  single-scenario path runs (no duplication). */
export async function loadComparisonScope(args: {
  clientId: string;
  firmId: string;
  currentScenarioId: string;
  proposedScenarioId: string;
}): Promise<ComparisonScopeData> {
  const { clientId, firmId, currentScenarioId, proposedScenarioId } = args;

  const [curTree, propTree] = await Promise.all([
    loadEffectiveTree(clientId, firmId, currentScenarioId, {}),
    loadEffectiveTree(clientId, firmId, proposedScenarioId, {}),
  ]);
  const curProjection  = runProjection(curTree.effectiveTree);
  const propProjection = runProjection(propTree.effectiveTree);

  const fetchAll = async (
    projection: ProjectionYear[],
  ): Promise<SideInput> => {
    const ctx = { client: { id: clientId }, projection };
    const [cashflow, balance, monteCarlo, allocation] = await Promise.all([
      Promise.resolve(getScope("cashflow").fetch(ctx)),
      Promise.resolve(getScope("balance").fetch(ctx)),
      Promise.resolve(getScope("monteCarlo").fetch(ctx)),
      Promise.resolve(getScope("allocation").fetch(ctx)),
    ]);
    return {
      projection,
      cashflow:   cashflow   as CashflowScopeData,
      balance:    balance    as BalanceScopeData,
      monteCarlo: monteCarlo as MonteCarloScopeData,
      allocation: allocation as AllocationScopeData,
    };
  };

  const [current, proposed] = await Promise.all([
    fetchAll(curProjection),
    fetchAll(propProjection),
  ]);

  return buildComparisonScopeData({ current, proposed });
}
