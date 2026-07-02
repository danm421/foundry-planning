import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectionResult, ClientData } from "@/engine";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import { estateDistributionAtYear } from "@/lib/estate/estate-distribution-at-year";
import { parseProjectionResponse } from "@/lib/solver/projection-wire";

interface Args {
  clientId: string;
  source: SolverSource;
  mutations: SolverMutation[];
  /** Client-side working tree — the `clientData` the estate report resolves
   *  ownership/labels against, matched to the working projection. */
  workingTree: ClientData;
  /** Base plan tree — paired with the base (source: "base", no mutations)
   *  projection for the "vs Base" delta. */
  baseClientData: ClientData;
  clientName: string;
  spouseName: string | null;
  /** Gate the fetches to when the KPI strip is visible (i.e. not the Summaries
   *  or Monte Carlo reports). */
  enabled: boolean;
}

/**
 * Sources the KPI strip's "Total to Heirs" tile. Unlike the other KPIs, the
 * estate transfer report needs a full projection *with death events*, which
 * only comes from the server (`includeEvents: true`). Mirrors the debounced
 * fetch pattern in `useSolverSummaryData`:
 *
 *  - Working scenario: debounced refetch on every edit while `enabled`.
 *  - Base plan: fetched once (it's fixed for the session) and cached.
 */
export function useSolverNetToHeirs(args: Args) {
  const { clientId, source, mutations, workingTree, baseClientData, clientName, spouseName, enabled } = args;

  const ownerNames = useMemo(() => ({ clientName, spouseName }), [clientName, spouseName]);

  const [working, setWorking] = useState<number | null>(null);
  const [base, setBase] = useState<number | null>(null);
  // Sourced from the same with-events working fetch that feeds the KPI. The
  // events-less `currentProjection` in the workspace has no death events, so
  // this hook is the only place `firstDeathEvent.year` is available to thread
  // down to the estate chart's death-order toggle.
  const [firstDeathYear, setFirstDeathYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Working scenario — debounced, re-runs whenever mutations change.
  useEffect(() => {
    if (!enabled) return;
    if (debounce.current) clearTimeout(debounce.current);
    const controller = new AbortController();
    setLoading(true);
    debounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/project`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, mutations, includeEvents: true }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // parseProjectionResponse (not res.json()) revives the projection's Map
        // fields, which JSON drops and estate consumers depend on.
        const data = parseProjectionResponse<{ projectionResult?: ProjectionResult }>(
          await res.text(),
        );
        // Anchor the KPI to the estate distribution at the second death (or the
        // final projected year if unmarried/single-death), routed through the
        // shared builder so the KPI equals the estate chart at its max slider
        // year by construction.
        const Y =
          data.projectionResult?.secondDeathEvent?.year ??
          data.projectionResult?.years.at(-1)?.year;
        setWorking(
          data.projectionResult && Y != null
            ? estateDistributionAtYear({
                projection: data.projectionResult,
                year: Y,
                clientData: workingTree,
                ownerNames,
              }).toHeirs
            : null,
        );
        setFirstDeathYear(data.projectionResult?.firstDeathEvent?.year ?? null);
      } catch {
        if (!controller.signal.aborted) {
          setWorking(null);
          setFirstDeathYear(null);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 600);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
      controller.abort();
    };
  }, [enabled, clientId, source, mutations, workingTree, ownerNames]);

  // Base plan — fetched once, then cached (the base tree doesn't change).
  // Guarded on `base == null` rather than a "started" ref: a ref guard strands
  // the base (and the vs-Base delta) forever when the first attempt is aborted
  // by effect cleanup — StrictMode's dev double-invoke, or switching to a
  // KPI-less report mid-flight. State-guarding retries until a value lands.
  useEffect(() => {
    if (!enabled || base != null) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/project`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source: "base", mutations: [], includeEvents: true }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = parseProjectionResponse<{ projectionResult?: ProjectionResult }>(
          await res.text(),
        );
        const Y =
          data.projectionResult?.secondDeathEvent?.year ??
          data.projectionResult?.years.at(-1)?.year;
        setBase(
          data.projectionResult && Y != null
            ? estateDistributionAtYear({
                projection: data.projectionResult,
                year: Y,
                clientData: baseClientData,
                ownerNames,
              }).toHeirs
            : null,
        );
      } catch {
        if (!controller.signal.aborted) setBase(null);
      }
    })();
    return () => { controller.abort(); };
  }, [enabled, clientId, baseClientData, ownerNames, base]);

  const delta = working != null && base != null ? working - base : null;
  return { netToHeirs: working, netToHeirsDelta: delta, firstDeathYear, loading };
}
