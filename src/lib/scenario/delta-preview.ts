// src/lib/scenario/delta-preview.ts
//
// Delta-preview cache: returns the signed contribution of a single toggle
// group to a headline metric (currently end-of-plan portfolio total).
//
// Signed delta = readMetric(otherToggles + thisToggleOn) - readMetric(otherToggles + thisToggleOff)
//
// Wrapped in React `cache()` so repeated calls within the same request share
// work. Because `cache()` keys on argument identity, the `otherTogglesKey`
// argument is the caller-provided STABLE serialization (sorted-key JSON) of
// the surrounding toggle state — produced via `hashToggleState` (or any
// equivalent stable serializer). Decoding is best-effort: callers are
// expected to pass the exact JSON shape `hashToggleState` emits (sorted
// `[key, value]` pairs), but a plain `Record<string, boolean>` JSON object
// is also accepted for ergonomic call sites.

import { cache } from "react";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjection } from "@/engine/projection";
import type { ProjectionYear } from "@/engine/types";
import type { ToggleState } from "@/engine/scenario/types";
import { hashToggleState } from "./cache-key";

export type DeltaMetric = "endOfPlanPortfolio";

export interface DeltaPreview {
  toggleId: string;
  delta: number;
  metricLabel: string;
}

/**
 * Stable serialization of the surrounding toggle state for use as a
 * cache key. Re-exports `hashToggleState` under the name callers in this
 * module use, so the delta-preview API is self-contained.
 */
export function serializeToggleState(state: ToggleState): string {
  return hashToggleState(state);
}

/** Decode whatever shape `serializeToggleState` produced back into a ToggleState. */
function decodeToggleState(key: string): ToggleState {
  if (!key) return {};
  const parsed = JSON.parse(key) as unknown;
  // hashToggleState emits `[ [k, v], ... ]`. Be tolerant of plain objects too.
  if (Array.isArray(parsed)) {
    const out: ToggleState = {};
    for (const entry of parsed) {
      if (Array.isArray(entry) && entry.length === 2 && typeof entry[0] === "string") {
        out[entry[0]] = Boolean(entry[1]);
      }
    }
    return out;
  }
  if (parsed && typeof parsed === "object") {
    const out: ToggleState = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      out[k] = Boolean(v);
    }
    return out;
  }
  return {};
}

function metricLabelFor(metric: DeltaMetric): string {
  switch (metric) {
    case "endOfPlanPortfolio":
      return "end-of-plan portfolio";
  }
}

function readMetric(years: ProjectionYear[], metric: DeltaMetric): number {
  const last = years.at(-1);
  if (!last) return 0;
  switch (metric) {
    case "endOfPlanPortfolio":
      return last.portfolioAssets.total;
  }
}

/**
 * Computes the signed contribution of toggling a single group on/off,
 * holding all other toggles at their state captured in `otherTogglesKey`.
 *
 * Cache identity is keyed on the full primitive argument tuple — repeat
 * calls with the same args within a request reuse the prior result.
 */
export const computeDeltaPreview = cache(
  async (
    clientId: string,
    firmId: string,
    scenarioId: string,
    otherTogglesKey: string,
    toggleId: string,
    metric: DeltaMetric,
  ): Promise<DeltaPreview> => {
    const otherToggles = decodeToggleState(otherTogglesKey);
    const onState: ToggleState = { ...otherToggles, [toggleId]: true };
    const offState: ToggleState = { ...otherToggles, [toggleId]: false };

    const [{ effectiveTree: onTree }, { effectiveTree: offTree }] = await Promise.all([
      loadEffectiveTree(clientId, firmId, scenarioId, onState),
      loadEffectiveTree(clientId, firmId, scenarioId, offState),
    ]);

    const onYears = runProjection(onTree);
    const offYears = runProjection(offTree);

    return {
      toggleId,
      delta: readMetric(onYears, metric) - readMetric(offYears, metric),
      metricLabel: metricLabelFor(metric),
    };
  },
);
