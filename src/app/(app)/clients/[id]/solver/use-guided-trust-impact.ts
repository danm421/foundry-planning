import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientData, ProjectionResult } from "@/engine";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import { applyMutations } from "@/lib/solver/apply-mutations";
import { estateImpactOf, type EstateImpact } from "@/lib/solver/estate-impact";
import { parseProjectionResponse } from "@/lib/solver/projection-wire";

interface Args {
  clientId: string;
  source: SolverSource;
  /** The Solver's current changes (the "before"). */
  mutations: SolverMutation[];
  /** Client-side working tree matching `mutations`. */
  tree: ClientData;
  /** The draft trust batch layered on top (the "after"). */
  batch: SolverMutation[];
  enabled: boolean;
}

type Result = { key: string; ok: true; before: EstateImpact; after: EstateImpact } | { key: string; ok: false };

type State =
  | { status: "idle" | "loading" | "error"; before: null; after: null }
  | { status: "ready"; before: EstateImpact; after: EstateImpact };

const IDLE: State = { status: "idle", before: null, after: null };

async function project(
  clientId: string,
  source: SolverSource,
  mutations: SolverMutation[],
  signal: AbortSignal,
): Promise<ProjectionResult> {
  const res = await fetch(`/api/clients/${clientId}/solver/project`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, mutations, includeEvents: true }),
    signal,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // parseProjectionResponse (not res.json()) revives the projection's Map fields.
  const data = parseProjectionResponse<{ projectionResult?: ProjectionResult }>(await res.text());
  if (!data.projectionResult) throw new Error("No projection");
  return data.projectionResult;
}

/** Runs the Solver's current changes with and without the draft trust batch,
 *  for the Review step's estimated estate-tax / heirs impact. Re-runs only
 *  when the batch's content changes, not its array identity. The "before"
 *  projection depends only on the Solver's own changes, so it is fetched once
 *  per set of changes and reused while the batch is edited. */
export function useGuidedTrustImpact(args: Args): State {
  const { clientId, source, enabled } = args;
  const batchKey = useMemo(() => JSON.stringify(args.batch), [args.batch]);
  const beforeKey = useMemo(
    () => JSON.stringify({ clientId, source, mutations: args.mutations }),
    [clientId, source, args.mutations],
  );
  const beforeCache = useRef<{ key: string; projection: ProjectionResult } | null>(null);
  // Latest inputs, read inside the effect so only the content key re-triggers it.
  const latest = useRef(args);
  useEffect(() => {
    latest.current = args;
  });

  // Keyed by the batch content so a stale result reads as "loading", not "ready".
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const { mutations, tree, batch } = latest.current;
    const controller = new AbortController();
    (async () => {
      try {
        const cached = beforeCache.current?.key === beforeKey ? beforeCache.current.projection : null;
        const [beforeProj, afterProj] = await Promise.all([
          cached ?? project(clientId, source, mutations, controller.signal),
          project(clientId, source, [...mutations, ...batch], controller.signal),
        ]);
        if (controller.signal.aborted) return;
        beforeCache.current = { key: beforeKey, projection: beforeProj };
        setResult({
          key: batchKey,
          ok: true,
          before: estateImpactOf(beforeProj, tree),
          after: estateImpactOf(afterProj, applyMutations(tree, batch)),
        });
      } catch {
        if (!controller.signal.aborted) setResult({ key: batchKey, ok: false });
      }
    })();
    return () => controller.abort();
  }, [enabled, clientId, source, batchKey, beforeKey]);

  if (!enabled) return IDLE;
  if (!result || result.key !== batchKey) return { status: "loading", before: null, after: null };
  if (!result.ok) return { status: "error", before: null, after: null };
  return { status: "ready", before: result.before, after: result.after };
}
