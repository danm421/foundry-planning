// src/lib/scenario/scenario-from-search-params.ts
//
// Server-side parser for the compare panel URL params. Converts
// `?left=…&right=…&toggles=…` into a `{ left, right }` pair of `ScenarioRef`s
// suitable for `loadEffectiveTreeForRef`.
//
// URL shapes supported:
//   - missing / "base"  → base case scenario, no toggles
//   - "snap:<id>"       → frozen snapshot (side baked in)
//   - "<sid>"           → live scenario id
//   - toggles=g1,g2     → toggle group ids; only honored on the right side
import type { ScenarioRef } from "@/lib/scenario/loader";
import type { ToggleState } from "@/engine/scenario/types";
import { MAX_PLANS } from "@/lib/comparison/series-palette";

export function parseCompareSearchParams(
  sp: Record<string, string | undefined>,
): { left: ScenarioRef; right: ScenarioRef } {
  return {
    left: parseSide(sp.left, sp.toggles, "left"),
    right: parseSide(sp.right, sp.toggles, "right"),
  };
}

function parseSide(
  side: string | undefined,
  toggles: string | undefined,
  which: "left" | "right",
): ScenarioRef {
  if (!side || side === "base") {
    return { kind: "scenario", id: "base", toggleState: {} };
  }
  if (side.startsWith("snap:")) {
    return { kind: "snapshot", id: side.slice("snap:".length), side: which };
  }
  // Plain scenario id; only the right side honors the `toggles` param.
  const toggleState: Record<string, boolean> = {};
  if (which === "right" && toggles) {
    for (const id of toggles.split(",").filter(Boolean)) {
      toggleState[id] = true;
    }
  }
  return { kind: "scenario", id: side, toggleState };
}

/**
 * Estate-planning panel ref. Either a regular scenario ref (live or snapshot)
 * or the synthetic "do nothing" counterfactual (`synthesizeNoPlanClientData`).
 */
export type EstateCompareRef = ScenarioRef | { kind: "do-nothing" };

export const ESTATE_COMPARE_DO_NOTHING = "do-nothing";

/**
 * Wraps `parseCompareSearchParams` with a `do-nothing` sentinel that maps to
 * the legacy synthesized "no plan" counterfactual. Estate-planning-only —
 * other panels keep using `parseCompareSearchParams` directly.
 */
export function parseEstateCompareSearchParams(
  sp: Record<string, string | undefined>,
): { left: EstateCompareRef; right: EstateCompareRef } {
  const refined = parseCompareSearchParams(sp);
  return {
    left:
      sp.left === ESTATE_COMPARE_DO_NOTHING ? { kind: "do-nothing" } : refined.left,
    right:
      sp.right === ESTATE_COMPARE_DO_NOTHING ? { kind: "do-nothing" } : refined.right,
  };
}

/**
 * Resolve a single side string ("base" | "<scenarioId>" | "snap:<snapId>")
 * into a `ScenarioRef`. Mirrors the URL parser above but takes an explicit
 * `toggleState` map (the snapshot POST body sends a `Record<string, boolean>`,
 * not the comma-delimited URL `toggles=` form). Used by the snapshot route to
 * convert client-supplied left/right strings into refs before freezing.
 */
export function refFromString(
  side: string,
  toggleState: ToggleState,
  which: "left" | "right",
): ScenarioRef {
  if (!side || side === "base") {
    return { kind: "scenario", id: "base", toggleState: {} };
  }
  if (side.startsWith("snap:")) {
    return { kind: "snapshot", id: side.slice("snap:".length), side: which };
  }
  // Live scenario id. Only the right side honors toggleState — the left side
  // always uses the unmodified scenario (matches the URL parser's contract).
  return {
    kind: "scenario",
    id: side,
    toggleState: which === "right" ? toggleState : {},
  };
}

/**
 * Parse the multi-scenario URL param `?plans=<ref0>,<ref1>,...`.
 *
 * - Each entry uses the same token grammar as `parseCompareSearchParams`:
 *   `base` | `<scenarioId>` | `snap:<snapshotId>`.
 * - Result is clamped to at most `MAX_PLANS` (4) entries.
 * - Result is padded to at least 2 entries by appending the base case.
 * - Toggles are not yet wired into multi-scenario; toggleState is `{}` per entry.
 * - If `plans` is missing, falls back to the legacy `?left=&right=` shape.
 * - If neither is present, returns `[base, base]`.
 */
export function parsePlansSearchParam(
  sp: Record<string, string | undefined>,
): ScenarioRef[] {
  const raw = sp.plans;
  let tokens: string[];
  if (raw && raw.length > 0) {
    tokens = raw.split(",").map((t) => t.trim()).filter(Boolean);
  } else if (sp.left !== undefined || sp.right !== undefined) {
    tokens = [sp.left ?? "base", sp.right ?? "base"];
  } else {
    tokens = ["base", "base"];
  }
  // Clamp upper bound, pad lower bound.
  if (tokens.length > MAX_PLANS) tokens = tokens.slice(0, MAX_PLANS);
  while (tokens.length < 2) tokens.push("base");
  return tokens.map((tok) => parsePlansToken(tok));
}

function parsePlansToken(tok: string): ScenarioRef {
  if (!tok || tok === "base") {
    return { kind: "scenario", id: "base", toggleState: {} };
  }
  if (tok.startsWith("snap:")) {
    // `side` is part of the snapshot ref shape; multi-scenario does not have
    // a meaningful left/right axis, so default to "left" — the snapshot loader
    // uses this only as a tie-breaker for parallel-snapshot scenarios.
    return { kind: "snapshot", id: tok.slice("snap:".length), side: "left" };
  }
  return { kind: "scenario", id: tok, toggleState: {} };
}
