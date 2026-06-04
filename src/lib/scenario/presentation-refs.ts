import type { ScenarioRef } from "@/lib/scenario/loader";

/**
 * Resolves a raw picker value (top-level or per-page) into a ScenarioRef.
 *   "base" | null | undefined → base scenario
 *   "snap:<id>"               → left-side snapshot
 *   "<uuid>"                  → live scenario
 * Mirrors the resolution that previously lived inline in the export route.
 */
export function resolveScenarioRef(raw: string | null | undefined): ScenarioRef {
  if (raw && raw.startsWith("snap:")) {
    return { kind: "snapshot", id: raw.slice("snap:".length), side: "left" };
  }
  if (raw && raw !== "base") {
    return { kind: "scenario", id: raw, toggleState: {} };
  }
  return { kind: "scenario", id: "base", toggleState: {} };
}

/** Stable map key per ref: "base" | "scenario:<id>" | "snap:<id>". */
export function keyForRef(ref: ScenarioRef): string {
  if (ref.kind === "snapshot") return `snap:${ref.id}`;
  return ref.id === "base" ? "base" : `scenario:${ref.id}`;
}

/**
 * Human-readable label for a ref, given a map of id → name resolved from the
 * DB. Base is a fixed literal; live scenarios and snapshots fall back to their
 * id / a generic label when the name isn't found.
 */
export function labelForRef(ref: ScenarioRef, names: Map<string, string>): string {
  if (ref.kind === "snapshot") return names.get(ref.id) ?? "Snapshot";
  return ref.id === "base" ? "Base Case" : (names.get(ref.id) ?? ref.id);
}

export interface PlannerPage {
  supportsScenarioOverride: boolean;
  scenarioOverride: string | null | undefined;
  /** This page requires a server-side Monte Carlo run for its scenario. True for
   *  the Monte Carlo page and the Retirement Summary (whose MC KPI needs it).
   *  Runs are deduped per distinct scenario, so two MC-needing pages on the same
   *  scenario trigger one run. */
  needsMonteCarloRun: boolean;
  isScenarioChanges: boolean;
  /** When set, this page is multi-scenario: it requires exactly these refs (raw
   *  tokens). Its top/override ref is ignored for data; `needsMonteCarloRun` and
   *  `isScenarioChanges` apply to each required ref (the latter only to live ones). */
  requiredRefs?: string[];
}

export interface DistinctBundlePlan {
  ref: ScenarioRef;
  needsMonteCarlo: boolean;
  needsScenarioChanges: boolean;
}

export interface ScenarioPlan {
  /** key → what to load for that distinct scenario. */
  distinct: Map<string, DistinctBundlePlan>;
  /** index-aligned with the input pages: the bundle key each page reads. */
  pageKeys: string[];
  /** key of the top-level scenario; non-overridable pages always use it. */
  topKey: string;
}

/**
 * Given the deck's pages and the top-level raw picker value, computes the
 * distinct set of scenario refs to load and which expensive payloads
 * (Monte Carlo, scenario-changes) each one needs. Pure — no DB / registry.
 */
export function planScenarioBundles(
  pages: PlannerPage[],
  topRaw: string | null | undefined,
): ScenarioPlan {
  const topRef = resolveScenarioRef(topRaw);
  const topKey = keyForRef(topRef);

  const distinct = new Map<string, DistinctBundlePlan>();
  distinct.set(topKey, {
    ref: topRef,
    needsMonteCarlo: false,
    needsScenarioChanges: false,
  });

  const register = (ref: ScenarioRef, p: PlannerPage): string => {
    const key = keyForRef(ref);
    const isLive = ref.kind === "scenario" && ref.id !== "base";
    const existing = distinct.get(key);
    if (existing) {
      existing.needsMonteCarlo ||= p.needsMonteCarloRun;
      existing.needsScenarioChanges ||= p.isScenarioChanges && isLive;
    } else {
      distinct.set(key, {
        ref,
        needsMonteCarlo: p.needsMonteCarloRun,
        needsScenarioChanges: p.isScenarioChanges && isLive,
      });
    }
    return key;
  };

  const pageKeys = pages.map((p) => {
    if (p.requiredRefs && p.requiredRefs.length > 0) {
      let firstKey = "";
      for (const raw of p.requiredRefs) {
        const key = register(resolveScenarioRef(raw), p);
        if (!firstKey) firstKey = key;
      }
      return firstKey;
    }
    const ref =
      p.supportsScenarioOverride && p.scenarioOverride !== undefined
        ? resolveScenarioRef(p.scenarioOverride)
        : topRef;
    return register(ref, p);
  });

  return { distinct, pageKeys, topKey };
}
