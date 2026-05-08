// src/lib/reports/data-loader.ts
//
// Three pure functions used by the PDF export pipeline:
// - `collectScopesFromTree` walks the report tree and aggregates the
//   scopes each widget declares (plus the dynamic scope list embedded
//   in `aiAnalysis` widget props).
// - `loadDataForScopes` fans out to the scope registry and parallel-
//   fetches each scope's data.
// - `buildWidgetData` resolves each kpiTile via the metric registry and
//   passes scope data through for chart/table widgets.

import "@/lib/reports/scopes"; // side-effect: register all v1 scopes
import "@/lib/reports/metrics"; // side-effect: register all v1 metrics

import type { OwnershipView, Page, WidgetKind, YearRange } from "./types";
import type { FamilyMember as FamilyMemberLike, ProjectionYear } from "@/engine/types";
import { getMetric } from "./metric-registry";
import { getScope, type ScopeKey } from "./scope-registry";
import { getWidget } from "./widget-registry";
import { resolveYearRange } from "./year-range-default";
import type { CashflowScopeData } from "./scopes/cashflow";
import type { BalanceScopeData } from "./scopes/balance";
import type { MonteCarloScopeData } from "./scopes/monteCarlo";
import {
  buildViewModel,
  type AccountLike,
  type EntityInfo,
  type LiabilityLike,
} from "@/components/balance-sheet-report/view-model";

/**
 * Reads a widget kind's declared scopes without crashing on unregistered
 * kinds. In v1 some kinds (e.g. `aiAnalysis`) have no registry entry yet —
 * traversing through them must not abort the entire export.
 */
function safeWidgetScopes(kind: WidgetKind): readonly ScopeKey[] {
  try {
    return getWidget(kind).scopes ?? [];
  } catch {
    return [];
  }
}

export function collectScopesFromTree(pages: Page[]): Set<ScopeKey> {
  const scopes = new Set<ScopeKey>();
  for (const p of pages) {
    for (const r of p.rows) {
      for (const w of r.slots) {
        if (!w) continue;
        for (const s of safeWidgetScopes(w.kind)) scopes.add(s);
        if (w.kind === "aiAnalysis") {
          for (const s of (w.props as { scopes: ScopeKey[] }).scopes) {
            scopes.add(s);
          }
        }
      }
    }
  }
  return scopes;
}

export async function loadDataForScopes(
  scopes: Set<ScopeKey>,
  ctx: { client: { id: string }; projection: ProjectionYear[] },
): Promise<Partial<Record<ScopeKey, unknown>>> {
  const out: Partial<Record<ScopeKey, unknown>> = {};
  await Promise.all(
    [...scopes].map(async (s) => {
      out[s] = await getScope(s).fetch(ctx);
    }),
  );
  return out;
}

export function buildWidgetData(
  pages: Page[],
  ctx: {
    projection: ProjectionYear[];
    scopeData: Partial<Record<ScopeKey, unknown>>;
    client: { id: string };
    /** Account / liability rows with raw `owners[]` arrays — the view-model
     *  expands them into per-owner slices. Entities carry their flat value,
     *  isIrrevocable flag, and entity_owners shares so business-interest
     *  classification works without DB lookups in here. */
    accounts: AccountLike[];
    liabilities: LiabilityLike[];
    entities: EntityInfo[];
    familyMembers: FamilyMemberLike[];
    /** Household context for resolving widget yearRange `"default"` sentinels.
     *  `retirementYear` is the calendar year the household retires (computed
     *  from DOB year + retirementAge at the call site); `currentYear` is the
     *  calendar year the export runs in. Both are needed because
     *  `resolveYearRange` derives the default `from`/`to` from them
     *  (see `lib/reports/year-range-default.ts`). */
    household: { retirementYear: number; currentYear: number };
  },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const p of pages) {
    for (const r of p.rows) {
      for (const w of r.slots) {
        if (!w) continue;
        if (w.kind === "kpiTile") {
          const props = w.props as { metricKey: string; showDelta?: boolean };
          const m = getMetric(props.metricKey);
          const year = ctx.projection[0]?.year ?? new Date().getFullYear();
          const prev = ctx.projection[0];
          out[w.id] = {
            value: m.fetch({
              client: ctx.client,
              projection: ctx.projection,
              year,
              prevYear: prev,
            }),
            prevValue: null,
          };
        } else if (
          w.kind === "cashflowBarChart" ||
          w.kind === "cashflowTable" ||
          w.kind === "incomeSourcesArea"
        ) {
          // Chart/table widgets each consume one scope — narrow the dict so
          // the widget render doesn't have to know the full scopeData shape.
          // Pre-filter `years` to the resolved range so PDF renders (which
          // don't re-run `resolveYearRange`) get the right slice.
          const props = w.props as { yearRange: YearRange };
          const range = resolveYearRange(props.yearRange, ctx.household);
          const cf = ctx.scopeData.cashflow as CashflowScopeData | undefined;
          const sliced = cf
            ? {
                years: cf.years.filter(
                  (y) => y.year >= range.from && y.year <= range.to,
                ),
              }
            : undefined;
          out[w.id] = { cashflow: sliced };
        } else if (w.kind === "netWorthLine") {
          const props = w.props as { yearRange: YearRange };
          const range = resolveYearRange(props.yearRange, ctx.household);
          const bal = ctx.scopeData.balance as BalanceScopeData | undefined;
          const sliced = bal
            ? {
                years: bal.years.filter(
                  (y) => y.year >= range.from && y.year <= range.to,
                ),
              }
            : undefined;
          out[w.id] = { balance: sliced };
        } else if (w.kind === "allocationDonut") {
          out[w.id] = { allocation: ctx.scopeData.allocation };
        } else if (w.kind === "monteCarloFan") {
          // Monte Carlo bands are per-year too; filter by the same range.
          // `successProbability` is a scalar — pass through unchanged.
          const props = w.props as { yearRange: YearRange };
          const range = resolveYearRange(props.yearRange, ctx.household);
          const mc = ctx.scopeData.monteCarlo as MonteCarloScopeData | undefined;
          const sliced = mc
            ? {
                successProbability: mc.successProbability,
                bands: mc.bands.filter(
                  (b) => b.year >= range.from && b.year <= range.to,
                ),
              }
            : undefined;
          out[w.id] = { monteCarlo: sliced };
        } else if (w.kind === "balanceSheetTable") {
          // Reuses the existing balance-sheet view-model to produce a fully-
          // shaped `BalanceSheetViewModel`. No scope is registered for this
          // widget — accounts/liabilities/entities flow through ctx directly.
          const props = w.props as {
            asOfYear: number | "current";
            ownership: OwnershipView;
            showEntityBreakdown: boolean;
          };
          const year =
            props.asOfYear === "current"
              ? (ctx.projection[0]?.year ?? new Date().getFullYear())
              : props.asOfYear;
          out[w.id] = buildViewModel({
            accounts: ctx.accounts,
            liabilities: ctx.liabilities,
            entities: ctx.entities,
            familyMembers: ctx.familyMembers,
            projectionYears: ctx.projection,
            selectedYear: year,
            view: props.ownership,
            asOfMode: "eoy",
            planStartYear: ctx.projection[0]?.year ?? year,
          });
        } else {
          // TODO(Task 19+): pass per-widget scope projection rather than the
          // full scopeData dict. Remaining widgets (e.g. aiAnalysis) get the
          // whole bag for now — interim plumbing for v1.
          out[w.id] = ctx.scopeData;
        }
      }
    }
  }
  return out;
}
