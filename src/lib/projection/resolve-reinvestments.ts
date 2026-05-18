// src/lib/projection/resolve-reinvestments.ts
//
// Reusable reinvestment resolution. The engine `Reinvestment` type carries
// resolved fields (`newGrowthRate`, `newRealization`, `soldFractionByAccount`)
// that the projection math consumes, plus the raw resolution INPUTS
// (`modelPortfolioId`, `customGrowthRate`, `customPct*`, `targetType`) that
// this module reads to (re)compute the resolved fields.
//
// Two call sites:
//   • `load-client-data.ts`         — resolves the base tree's reinvestments.
//   • `scenario/loader.ts`          — re-resolves the effective tree's
//                                     reinvestments after `applyScenarioChanges`
//                                     merges raw-shaped scenario payloads.
//
// `resolveReinvestments` is idempotent: running it on already-resolved entries
// (that still carry the raw fields) yields the same result.

import type { Account, Reinvestment } from "@/engine/types";
import type { GrowthSourceResolver } from "./resolve-entity";
import { soldFraction, type AllocationMap } from "./reinvestment-sold-fraction";

/**
 * Per-account base allocation context the soldFraction chain needs. The base
 * allocation is an account's asset-class mix BEFORE any reinvestment, derived
 * from the account's effective growth source — model-portfolio-backed or
 * asset-mix-backed accounts have one; flat-rate / inflation / custom accounts
 * do not. The caller (`load-client-data.ts`) builds this from the raw account
 * rows because the engine `Account` type does not carry `growthSource` /
 * `modelPortfolioId`. Accounts absent from the map (scenario-added, or no
 * asset-class breakdown) resolve to a conservative full turnover.
 */
export type AccountBaseAllocMap = Map<string, AllocationMap | undefined>;

export interface ResolveReinvestmentsContext {
  resolver: GrowthSourceResolver;
  /** Base (pre-reinvestment) allocation per account id. */
  accountBaseAllocByAccountId: AccountBaseAllocMap;
}

/**
 * (Re)compute `newGrowthRate`, `newRealization`, and `soldFractionByAccount`
 * for each reinvestment from its raw resolution-input fields. Returns a new
 * array of new objects — does not mutate the input entries.
 *
 * The soldFraction chain processes each account's reinvestments in year order
 * so a later reinvestment's prior allocation is the previous reinvestment's
 * target allocation, not the account's base allocation.
 */
export function resolveReinvestments(
  reinvestments: readonly Reinvestment[],
  ctx: ResolveReinvestmentsContext,
): Reinvestment[] {
  const { resolver, accountBaseAllocByAccountId } = ctx;

  // 1. Resolve newGrowthRate + newRealization per reinvestment.
  const resolved: Reinvestment[] = reinvestments.map((r) => {
    let newGrowthRate: number;
    // `turnoverPct` below is a placeholder. Turnover is an account-level
    // property the resolver cannot know (model portfolios / custom inputs
    // don't carry it); `applyReinvestments` overrides it per target account
    // with that account's own existing turnover.
    let newRealization: Account["realization"] | undefined;

    if (r.targetType === "model_portfolio" && r.modelPortfolioId) {
      const p = resolver.resolvePortfolio(r.modelPortfolioId);
      newGrowthRate = p.geoReturn;
      newRealization = {
        pctOrdinaryIncome: p.pctOi,
        pctLtCapitalGains: p.pctLtcg,
        pctQualifiedDividends: p.pctQdiv,
        pctTaxExempt: p.pctTaxEx,
        turnoverPct: 0,
      };
    } else {
      newGrowthRate = num(r.customGrowthRate, 0);
      newRealization = {
        pctOrdinaryIncome: num(r.customPctOrdinaryIncome, 1),
        pctLtCapitalGains: num(r.customPctLtCapitalGains, 0),
        pctQualifiedDividends: num(r.customPctQualifiedDividends, 0),
        pctTaxExempt: num(r.customPctTaxExempt, 0),
        turnoverPct: 0,
      };
    }

    return {
      ...r,
      newGrowthRate,
      newRealization,
      // soldFractionByAccount is recomputed below; start fresh so a stale
      // entry from a prior resolution pass is not carried forward.
      soldFractionByAccount: {},
    };
  });

  // 2. Precompute soldFraction per (reinvestment, account). Process each
  //    account's reinvestments in year order so the chain resolves correctly.
  const riByAccount = new Map<string, Reinvestment[]>();
  for (const ri of resolved) {
    for (const accountId of ri.accountIds) {
      const list = riByAccount.get(accountId) ?? [];
      list.push(ri);
      riByAccount.set(accountId, list);
    }
  }

  for (const [accountId, list] of riByAccount) {
    list.sort((a, b) => a.year - b.year);
    let prevAlloc = accountBaseAllocByAccountId.get(accountId);
    for (const ri of list) {
      const nextAlloc =
        ri.targetType === "model_portfolio" && ri.modelPortfolioId
          ? resolver.portfolioAllocMap(ri.modelPortfolioId)
          : undefined;
      ri.soldFractionByAccount[accountId] = soldFraction(prevAlloc, nextAlloc);
      prevAlloc = nextAlloc;
    }
  }

  return resolved;
}

/** Coerce a raw numeric input (number, decimal string, or null/undefined) to
 *  a number, falling back to `fallback` for null/undefined. Distinct from
 *  resolve-entity's `n`/`nNullable` (fixed 0/undefined fallback) because the
 *  custom-realization fields need a non-zero default — `customPctOrdinaryIncome`
 *  falls back to 1 (a fully ordinary-income mix). */
function num(v: number | string | null | undefined, fallback: number): number {
  if (v == null) return fallback;
  return typeof v === "number" ? v : parseFloat(v);
}
