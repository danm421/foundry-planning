"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useClientAccess } from "@/components/client-access-provider";
import MonteCarloSkeleton from "@/app/(app)/clients/[id]/cashflow/monte-carlo/loading-skeleton";
import { MonteCarloReportView } from "./monte-carlo/report-view";
import type {
  MonteCarloSummary,
  MonteCarloResult,
} from "@/engine";
import type { CachedMonteCarloResult } from "@/lib/compute-cache/monte-carlo";

interface Props {
  clientId: string;
  /**
   * Scenario id to load. Threaded through the cached monte-carlo fetch via
   * `?scenario=` from the page handler.
   */
  scenarioId?: string | "base";
}


export default function MonteCarloReport({ clientId }: Props) {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const searchParams = useSearchParams();
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch + reseed state. Nothing runs client-side any more; `loading` covers
  // both the initial cached fetch and a reseed refetch.
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<MonteCarloSummary | null>(null);
  const [reseedError, setReseedError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<MonteCarloResult | null>(null);
  const [deterministic, setDeterministic] = useState<number[]>([]);
  const [meta, setMeta] = useState<CachedMonteCarloResult["meta"] | null>(null);

  // Bumped by "Generate New Seed" to re-trigger the cached fetch after a reseed.
  const [refreshKey, setRefreshKey] = useState(0);
  // Identifies the current client+scenario so the fetch effect can tell a
  // navigation (hard-reset stale data) from a reseed (keep the report visible).
  const scenarioParam = searchParams?.get("scenario") ?? null;
  const lastDataKeyRef = useRef<string | null>(null);

  // Fetch the cached Monte Carlo result. The route computes/caches server-side
  // (no client-side simulation), so revisits are instant and there's no freeze.
  //
  // The Next.js App Router keeps this page component mounted across
  // /clients/[id]/... param changes, so changing client/scenario doesn't
  // unmount us. On a navigation we hard-reset per-plan state so the previous
  // plan's summary/KPIs/table don't linger until the new fetch resolves. On a
  // reseed (same client+scenario, bumped refreshKey) we keep the current report
  // on screen and just refetch — avoids a full-page skeleton flash.
  useEffect(() => {
    const dataKey = `${clientId}::${scenarioParam ?? ""}`;
    const isReseed = lastDataKeyRef.current === dataKey;
    lastDataKeyRef.current = dataKey;
    if (!isReseed) {
      setSummary(null);
      setLastResult(null);
      setDeterministic([]);
      setMeta(null);
    }
    setLoadError(null);
    setReseedError(null);
    setLoading(true);

    let cancelled = false;
    (async () => {
      try {
        const url = scenarioParam
          ? `/api/clients/${clientId}/monte-carlo?scenario=${encodeURIComponent(scenarioParam)}`
          : `/api/clients/${clientId}/monte-carlo`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`monte-carlo: HTTP ${res.status}`);
        const data = (await res.json()) as CachedMonteCarloResult;
        if (cancelled) return;
        setSummary(data.payload.summary);
        setLastResult(data.raw);
        setDeterministic(data.payload.deterministic);
        setMeta(data.meta);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, scenarioParam, refreshKey]);

  // "Generate New Seed": persist a fresh seed to the scenario, then re-fetch.
  // The reseed changes the stored seed → input hash changes → next fetch is a
  // natural cache MISS → the route recomputes with the new seed.
  const handleRestart = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/monte-carlo-data`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setReseedError(e instanceof Error ? e.message : String(e));
    }
  }, [clientId]);

  if (loadError) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold mb-2">Monte Carlo Simulation</h1>
        <div className="text-crit">Failed to load: {loadError}</div>
      </div>
    );
  }
  if (!meta) return <MonteCarloSkeleton />;
  return (
    <div className="p-8 space-y-6">
      <MonteCarloReportView
        summary={summary}
        raw={lastResult}
        deterministic={deterministic}
        meta={meta}
        showHeader
        onReseed={canEdit ? handleRestart : undefined}
        reseedBusy={loading}
        reseedError={reseedError}
      />
    </div>
  );
}
