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
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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
