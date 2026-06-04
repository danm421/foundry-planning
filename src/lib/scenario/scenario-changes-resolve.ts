// src/lib/scenario/scenario-changes-resolve.ts
//
// Server-side assembly of the resolution maps injected into the Scenario
// Changes / Retirement Comparison report context (`ScenarioChangesContext.resolve`).
// The describers consume these maps to render rich names ("Joint Brokerage",
// "Jane Doe", "Family Trust") instead of terse fallbacks ("an account",
// "a recipient", "an entity").
//
// `buildBaseResolveData` / `hasReinvestmentChange` / `applyReinvestmentEnrichment`
// are PURE (no DB / no engine math) so they are unit-testable in plain vitest.
// Any DB-backed derivation of the reinvestment deps happens in the export route.

import type { ClientData } from "@/engine/types";
import type { ScenarioChange } from "@/engine/scenario/types";
import {
  EMPTY_RESOLVE_DATA,
  type ResolveContextData,
  type AccountInfo,
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
