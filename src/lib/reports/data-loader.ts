// src/lib/reports/data-loader.ts
//
// Stub for the report data-loader pipeline. Task 13 wires the export
// route end-to-end with empty/placeholder data so the PDF flow renders
// without real engine output. Task 14 replaces these three functions
// with real scope collection, scope-data fetching, and per-widget data
// shaping. Do not add tests here — Task 14 owns testing.
//
// The underscore-prefixed parameters are deliberate stubs for Task 14
// — disable the unused-vars warning for this file rather than churn
// the signatures.
/* eslint-disable @typescript-eslint/no-unused-vars */

import type { Page } from "./types";
import type { ScopeKey } from "./scope-registry";
import type { ProjectionYear } from "@/engine/types";

export function collectScopesFromTree(_pages: Page[]): Set<ScopeKey> {
  return new Set();
}

export async function loadDataForScopes(
  _scopes: Set<ScopeKey>,
  _ctx: { client: { id: string }; projection: ProjectionYear[] },
): Promise<Partial<Record<ScopeKey, unknown>>> {
  return {};
}

export function buildWidgetData(
  pages: Page[],
  _ctx: {
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
          out[w.id] = { value: null, prevValue: null };
        } else {
          out[w.id] = null;
        }
      }
    }
  }
  return out;
}
