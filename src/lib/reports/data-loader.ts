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

import type { Page, WidgetKind } from "./types";
import type { ProjectionYear } from "@/engine/types";
import { getMetric } from "./metric-registry";
import { getScope, type ScopeKey } from "./scope-registry";
import { getWidget } from "./widget-registry";

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
          out[w.id] = { cashflow: ctx.scopeData.cashflow };
        } else if (w.kind === "netWorthLine") {
          out[w.id] = { balance: ctx.scopeData.balance };
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
