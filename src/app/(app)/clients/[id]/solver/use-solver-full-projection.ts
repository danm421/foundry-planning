import { useEffect, useRef, useState } from "react";
import type { ProjectionResult } from "@/engine";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import { parseProjectionResponse } from "@/lib/solver/projection-wire";

/** Debounce before hitting the projection route. Long enough that dragging a
 *  lever slider doesn't fire a request per frame. */
const DEBOUNCE_MS = 600;

interface Args {
  clientId: string;
  source: SolverSource;
  mutations: SolverMutation[];
  /** Fetch only while the consuming surface is on screen. Callers own the
   *  condition — the Summaries deck's Estate tab and the Estate report's Flow
   *  Chart sub-tab are mutually exclusive, so this never runs twice at once. */
  enabled: boolean;
}

/**
 * Debounced fetch of the FULL working projection — the superset of the
 * `ProjectionYear[]` the Solver holds in memory, carrying the death events and
 * ledgers that estate surfaces need.
 */
export function useSolverFullProjection({
  clientId,
  source,
  mutations,
  enabled,
}: Args): { projection: ProjectionResult | undefined; loading: boolean } {
  const [projection, setProjection] = useState<ProjectionResult | undefined>(undefined);
  // Initialised from `enabled` for a hook that's enabled on mount — no
  // current caller does this (`solver-chart-panel.tsx` inits `estateSubTab`
  // to `"charts"`, `use-solver-summary-data.ts`'s caller inits
  // `activeSummary` to `"retirement"`), but it's cheap correctness for a
  // future one that does.
  const [loading, setLoading] = useState(enabled);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // This hook's callers (the Summaries deck, the Estate report's Flow Chart
  // sub-tab) don't mount it fresh when they turn it on — it's a long-lived
  // instance whose `enabled` flips true later, from a click. The `useState`
  // initialiser above only fires at the ONE true mount, which is normally
  // while `enabled` is still false (the default sub-tab is Charts). Without
  // this block, the first render after `enabled` flips true still carries the
  // stale `loading: false` from before — the effect below only corrects it
  // AFTER that render commits (a real DOM paint, since a browser defers
  // passive effects), so a caller like the Flow Chart branch paints one frame
  // of "unavailable" before flipping to "loading". Setting state directly
  // during render (React's documented "adjust state when a prop changes"
  // pattern) makes React redo this render with the corrected value before
  // anything commits — no visible frame is lost. The previous value has to
  // live in `useState`, not a `useRef`: the docs are explicit that writing
  // `ref.current` during render is unsafe, because a ref mutation survives a
  // render that gets thrown away and restarted (refs aren't part of the
  // reconciler's undo bookkeeping the way state is) — the guard would then
  // believe it already saw this `enabled` value and silently never fire
  // again. No caller on this branch uses `startTransition` / `useTransition`
  // / `useDeferredValue` today, so a discarded-render can't happen yet — but
  // the fix should still match the pattern it claims to follow.
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (enabled) setLoading(true);
  }

  useEffect(() => {
    if (!enabled) return;
    if (debounce.current) clearTimeout(debounce.current);
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/project`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, mutations, includeEvents: true }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // parseProjectionResponse (not res.json()) revives the projection's Map
        // fields, which JSON drops. See projection-wire.ts.
        const data = parseProjectionResponse<{ projectionResult?: ProjectionResult }>(
          await res.text(),
        );
        setProjection(data.projectionResult);
      } catch {
        setProjection(undefined);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      setLoading(false);
    };
  }, [enabled, clientId, source, mutations]);

  return { projection, loading };
}
