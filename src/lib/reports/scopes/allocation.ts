// src/lib/reports/scopes/allocation.ts
//
// Allocation scope: extracts a current-year asset-class breakdown from the
// projection for the allocationDonut widget (Task 27).
//
// Mapping decisions (worth knowing before reading the numbers):
//
// 1. `byClass` rolls up the six engine asset categories exposed on
//    `ProjectionYear.portfolioAssets`: cash, taxable, retirement, real
//    estate, business, life insurance. These are the engine's actual
//    partition — no inventing of "totalAssets" or other categories.
//    Percentages are computed against `portfolioAssets.total`, the engine's
//    EoY rollup. Categories with zero balances are filtered so the donut
//    doesn't render slivers.
//
// 2. `byType` (stocks vs bonds vs cash equivalents) is intentionally empty
//    in v1. The engine doesn't expose CMA asset-type rollups at the
//    ProjectionYear level — getting it right requires walking each
//    portfolio account's CMA membership weighted by the per-account
//    allocation. Documented in future-work/engine.md → Foundry Reports v1
//    follow-ups; the field stays on the type so the v2 wiring slots in
//    without a shape change.
//
// Only `projection[0]` is consulted — donuts are point-in-time. Future
// "as-of-year" support will scan the projection for the matching year.
import { registerScope } from "@/lib/reports/scope-registry";
import type { ProjectionYear } from "@/engine/types";

export type AllocationScopeData = {
  byClass: { className: string; value: number; pct: number }[];
  /** Always empty in v1 — engine doesn't expose asset-type rollups at the
   *  year level. See future-work/engine.md → Foundry Reports v1 follow-ups. */
  byType: { typeName: string; value: number; pct: number }[];
};

const CATEGORIES: {
  key: keyof ProjectionYear["portfolioAssets"];
  className: string;
}[] = [
  { key: "cashTotal", className: "Cash" },
  { key: "taxableTotal", className: "Taxable" },
  { key: "retirementTotal", className: "Retirement" },
  { key: "realEstateTotal", className: "Real Estate" },
  { key: "businessTotal", className: "Business" },
  { key: "lifeInsuranceTotal", className: "Life Insurance" },
];

registerScope({
  key: "allocation",
  label: "Allocation",
  fetch: ({ projection }): AllocationScopeData => {
    const cur = projection[0];
    if (!cur) return { byClass: [], byType: [] };
    const total = cur.portfolioAssets.total || 0;
    const byClass = CATEGORIES.map((c) => {
      const value = cur.portfolioAssets[c.key] as number;
      return {
        className: c.className,
        value,
        pct: total ? value / total : 0,
      };
    }).filter((b) => b.value > 0);
    return { byClass, byType: [] };
  },
  serializeForAI: (data) => {
    const d = data as AllocationScopeData;
    if (!d.byClass.length) return "Allocation: no data.";
    return `Allocation: ${d.byClass
      .map((c) => `${c.className} ${(c.pct * 100).toFixed(0)}%`)
      .join(", ")}.`;
  },
});
