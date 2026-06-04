// src/lib/scenario/scenario-changes-resolve.ts
//
// Server-side assembly of the resolution maps injected into the Scenario
// Changes / Retirement Comparison report context (`ScenarioChangesContext.resolve`).
// The describers consume these maps to render rich names ("Joint Brokerage",
// "Jane Doe", "Family Trust") instead of terse fallbacks ("an account",
// "a recipient", "an entity").
//
// Every exported helper here is PURE (no DB, no I/O) so it is unit-testable in
// plain vitest. Some accept engine *output* types (e.g. ProjectionYear in
// buildAssetTxResolveData) and reshape them — a value-level transform, not
// engine math. DB-backed derivation (catalog loads etc.) stays in the export
// route, which feeds the loaded data into buildReinvestmentEnrichmentDeps.

import type { ClientData, ProjectionYear, Reinvestment } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import {
  EMPTY_RESOLVE_DATA,
  type ResolveContextData,
  type AccountInfo,
  type AssetTxInfo,
} from "@/lib/presentations/pages/scenario-changes/describe/resolve";

/**
 * Pure base resolution data: account names + categories, recipient names
 * (family members keyed `family_member:<id>`, external beneficiaries keyed
 * `external_beneficiary:<id>`, entities keyed `entity:<id>`), entity names, and
 * the spouse's name — all read directly off the effective (scenario-overlaid)
 * tree. Robust to missing optional collections. Always populated for real
 * exports — this is the high-value path that makes transfer / savings / roth /
 * gift / will changes resolve to human-readable references.
 */
export function buildBaseResolveData(tree: ClientData): ResolveContextData {
  const accountsById: Record<string, AccountInfo> = {};
  for (const a of tree.accounts ?? []) {
    accountsById[a.id] = { name: a.name, category: a.category, subType: a.subType };
  }

  const recipientsById: Record<string, string> = {};
  for (const f of tree.familyMembers ?? []) {
    recipientsById[`family_member:${f.id}`] =
      `${f.firstName}${f.lastName ? ` ${f.lastName}` : ""}`;
  }
  for (const x of tree.externalBeneficiaries ?? []) {
    recipientsById[`external_beneficiary:${x.id}`] = x.name;
  }

  const entitiesById: Record<string, string> = {};
  for (const e of tree.entities ?? []) {
    // EntitySummary.name is optional; some engine call sites build entity
    // arrays without a display name. Skip those — there is nothing to resolve.
    if (e.id && e.name) {
      entitiesById[e.id] = e.name;
      recipientsById[`entity:${e.id}`] = e.name;
    }
  }

  return {
    ...EMPTY_RESOLVE_DATA,
    accountsById,
    recipientsById,
    entitiesById,
    spouseName: tree.client?.spouseName ?? null,
  };
}

/** True when any change targets a reinvestment (the only kind that benefits
 *  from the model-portfolio / base-allocation enrichment). */
export function hasReinvestmentChange(changes: ScenarioChange[]): boolean {
  return changes.some((c) => c.targetKind === "reinvestment");
}

/**
 * Pure reshape of the projection's per-year technique breakdown into a
 * `transactionId → AssetTxInfo` map for the asset_transaction describer. The
 * raw scenario-change payload only carries the *intent* of a buy/sell (which
 * account, which year, where proceeds land) — the actual value sold and the
 * net cash received are projection outputs (a sale at a projected market value,
 * netted of transaction costs / mortgage payoff / §121 exclusion). A
 * transaction executes in exactly one year, so the last writer wins is moot;
 * skipped sales surface as a 0-value entry and the describer ignores those.
 */
export function buildAssetTxResolveData(years: ProjectionYear[]): Record<string, AssetTxInfo> {
  const out: Record<string, AssetTxInfo> = {};
  for (const y of years) {
    const tb = y.techniqueBreakdown;
    if (!tb) continue;
    for (const s of tb.sales) {
      out[s.transactionId] = {
        type: "sell",
        saleValue: s.saleValue,
        netProceeds: s.netProceeds,
        capitalGain: s.capitalGain,
        transactionCosts: s.transactionCosts,
        mortgagePaidOff: s.mortgagePaidOff,
      };
    }
    for (const p of tb.purchases) {
      out[p.transactionId] = {
        type: "buy",
        purchasePrice: p.purchasePrice,
        mortgageAmount: p.mortgageAmount,
        equity: p.equity,
      };
    }
  }
  return out;
}

/**
 * Deps for the reinvestment enrichment, derived (best-effort) from the
 * investments bundle in the export route.
 *
 * - `modelPortfolio*ById` are keyed by **model-portfolio id**.
 * - `baseAllocation*ById` are keyed by **account id** (the account's prior /
 *   base asset mix, shown as the "before" state of a reinvestment switch).
 *
 * Rates are geometric-return fractions (e.g. 0.062 for 6.2%). When the mix
 * label can't be derived cleanly, pass an empty `baseAllocationMixById` — the
 * describer degrades to a blended-rate-only / "(custom mix)" presentation.
 */
export interface ReinvestmentEnrichmentDeps {
  modelPortfolioNamesById: Record<string, string>;
  modelPortfolioRatesById: Record<string, number>;
  baseAllocationMixById: Record<string, string>;
  baseAllocationBlendedRateById: Record<string, number>;
}

/**
 * Pure mapping: fold the (route-derived) deps into the
 * `modelPortfoliosById` / `baseAllocationsById` maps the resolve context
 * exposes. Never throws. Unmatched rates default to 0; a missing mix label
 * resolves to "" (the describer renders the blended-rate-only form).
 */
export function applyReinvestmentEnrichment(
  base: ResolveContextData,
  deps: ReinvestmentEnrichmentDeps,
): ResolveContextData {
  const modelPortfoliosById: ResolveContextData["modelPortfoliosById"] = {};
  for (const [id, name] of Object.entries(deps.modelPortfolioNamesById)) {
    modelPortfoliosById[id] = { name, rate: deps.modelPortfolioRatesById[id] ?? 0 };
  }

  const baseAllocationsById: ResolveContextData["baseAllocationsById"] = {};
  // Union of ids present in either map so a blended-rate-only account (no mix
  // label) still surfaces.
  const allocIds = new Set([
    ...Object.keys(deps.baseAllocationMixById),
    ...Object.keys(deps.baseAllocationBlendedRateById),
  ]);
  for (const id of allocIds) {
    baseAllocationsById[id] = {
      mix: deps.baseAllocationMixById[id] ?? "",
      blendedRate: deps.baseAllocationBlendedRateById[id] ?? 0,
    };
  }

  return { ...base, modelPortfoliosById, baseAllocationsById };
}

/**
 * Assemble the model-portfolio half of `ReinvestmentEnrichmentDeps` from the
 * three inputs the export route already has on hand:
 *  - `changes`           — the scenario edits (the model-portfolio ids the
 *                          report actually references live in their payloads).
 *  - `portfolioNamesById` — model-portfolio id → display name, from the firm's
 *                          investment-option catalog.
 *  - `reinvestments`     — the effective tree's already-resolved reinvestments,
 *                          which carry the blended `newGrowthRate` per portfolio.
 *
 * Scoped to the portfolios referenced by reinvestment changes so the enrichment
 * map stays small. Base-allocation maps are left empty (the describer renders
 * the new-portfolio line without the "before" mix). Never throws.
 */
export function buildReinvestmentEnrichmentDeps(
  changes: ScenarioChange[],
  portfolioNamesById: Record<string, string>,
  reinvestments: readonly Reinvestment[],
): ReinvestmentEnrichmentDeps {
  const rateByPortfolio = new Map<string, number>();
  for (const r of reinvestments) {
    if (r.modelPortfolioId != null && typeof r.newGrowthRate === "number") {
      rateByPortfolio.set(r.modelPortfolioId, r.newGrowthRate);
    }
  }

  const modelPortfolioNamesById: Record<string, string> = {};
  const modelPortfolioRatesById: Record<string, number> = {};
  for (const c of changes) {
    if (c.targetKind !== "reinvestment") continue;
    const pid = (c.payload as { modelPortfolioId?: string | null } | null)?.modelPortfolioId;
    if (!pid) continue;
    const name = portfolioNamesById[pid];
    if (name != null) modelPortfolioNamesById[pid] = name;
    const rate = rateByPortfolio.get(pid);
    if (rate != null) modelPortfolioRatesById[pid] = rate;
  }

  return {
    modelPortfolioNamesById,
    modelPortfolioRatesById,
    baseAllocationMixById: {},
    baseAllocationBlendedRateById: {},
  };
}
