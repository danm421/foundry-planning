"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useThemeName } from "@/lib/chart-colors";
import { useClientAccess } from "@/components/client-access-provider";
import { colors, colorsLight } from "@/brand";
import MonteCarloSkeleton from "@/app/(app)/clients/[id]/cashflow/monte-carlo/loading-skeleton";
import { ReportHeader } from "./monte-carlo/report-header";
import { KpiBand } from "./monte-carlo/kpi-band";
import { FanChart } from "./monte-carlo/fan-chart";
import { FindingsCard } from "./monte-carlo/findings-card";
import { RecommendationsCard } from "./monte-carlo/recommendations-card";
import { TerminalHistogram } from "./monte-carlo/terminal-histogram";
import { LongevityChart } from "./monte-carlo/longevity-chart";
import { YearlyBreakdown } from "./monte-carlo/yearly-breakdown";
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
  const theme = useThemeName();
  const brandColors = theme === "light" ? colorsLight : colors;
  const [loadError, setLoadError] = useState<string | null>(null);

  // Fetch + reseed state. Nothing runs client-side any more; `loading` covers
  // both the initial cached fetch and a reseed refetch.
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<MonteCarloSummary | null>(null);
  const [reseedError, setReseedError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<MonteCarloResult | null>(null);
  const [deterministic, setDeterministic] = useState<number[]>([]);
  const [meta, setMeta] = useState<CachedMonteCarloResult["meta"] | null>(null);
  const [mainChart, setMainChart] = useState<"fan" | "histogram" | "longevity">("fan");

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

  const ageMarkers = useMemo(() => {
    if (!meta) return [];
    const markers: Array<{ age: number; label: string; color: string }> = [
      { age: meta.retirementAge, label: `Retire ${meta.retirementAge}`, color: brandColors.cat.income },
    ];
    if (meta.spouseRetirementAge != null && meta.spouseRetirementAge !== meta.retirementAge) {
      markers.push({
        age: meta.spouseRetirementAge,
        label: `Spouse ${meta.spouseRetirementAge}`,
        color: brandColors.cat.life,
      });
    }
    return markers;
  }, [meta, brandColors]);

  // byYearLiquidAssetsPerTrial is trial-major ([trial][year]), so map each
  // trial to its last year's value to get the per-trial terminal balance array.
  const endingValues = useMemo(() => {
    if (!lastResult) return [];
    return lastResult.byYearLiquidAssetsPerTrial.map((trial) => trial.at(-1) ?? 0);
  }, [lastResult]);

  if (loadError) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold mb-2">Monte Carlo Simulation</h1>
        <div className="text-crit">Failed to load: {loadError}</div>
      </div>
    );
  }

  if (!meta) {
    return <MonteCarloSkeleton />;
  }

  return (
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div className="flex flex-col gap-6 min-w-0">
          <ReportHeader clientDisplayName={meta.clientDisplayName} />
          {/* F16 disclosure: MC volatility/mixes are always base-case. */}
          <p className="text-[12px] text-ink-3 -mt-3">
            Monte Carlo uses base-case asset mixes and volatility.
          </p>
          {summary ? (
            <KpiBand
              summary={summary}
              startAge={summary.byYear[0]?.age?.client ?? 0}
              annualIncome={meta.annualIncomeAtStart}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={`rounded-lg bg-card ring-1 ring-hair p-4 min-h-[96px] animate-pulse${i === 0 ? " lg:col-span-2" : ""}`}
                />
              ))}
            </div>
          )}

          {summary && lastResult ? (
            <>
              {mainChart === "fan" && (
                <FanChart
                  summary={summary}
                  deterministic={deterministic}
                  ageMarkers={ageMarkers}
                  variant="main"
                />
              )}
              {mainChart === "histogram" && (
                <TerminalHistogram
                  endingValues={endingValues}
                  trialsRun={summary.trialsRun}
                  requiredMinimumAssetLevel={meta.requiredMinimumAssetLevel}
                  startingLiquidBalance={meta.startingLiquidBalance}
                  variant="main"
                />
              )}
              {mainChart === "longevity" && (
                <LongevityChart
                  byYearLiquidAssetsPerTrial={lastResult.byYearLiquidAssetsPerTrial}
                  requiredMinimumAssetLevel={meta.requiredMinimumAssetLevel}
                  planStartYear={meta.planStartYear}
                  clientBirthYear={meta.clientBirthYear}
                  variant="main"
                />
              )}
            </>
          ) : (
            <div className="rounded-lg bg-card ring-1 ring-hair h-[440px] animate-pulse" />
          )}

          {reseedError && (
            <div className="rounded border border-crit/40 bg-crit/10 p-4 text-sm text-crit">
              Couldn’t generate a new seed: {reseedError}
            </div>
          )}

          {summary ? (
            <YearlyBreakdown summary={summary} />
          ) : (
            <div className="rounded-lg bg-card ring-1 ring-hair h-[320px] animate-pulse" />
          )}

          {summary && canEdit ? (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleRestart}
                disabled={loading}
                className="rounded-lg border border-hair bg-card px-4 py-2 text-sm text-ink-2 hover:border-good/60 hover:text-good disabled:opacity-50"
              >
                {loading ? "Generating…" : "Generate New Seed"}
              </button>
            </div>
          ) : null}
        </div>
        <aside className="flex flex-col gap-4">
          {summary && lastResult ? (
            <>
              <FindingsCard summary={summary} />
              {mainChart !== "fan" && (
                <FanChart
                  summary={summary}
                  deterministic={deterministic}
                  ageMarkers={ageMarkers}
                  variant="compact"
                  onPromote={() => setMainChart("fan")}
                />
              )}
              {mainChart !== "histogram" && (
                <TerminalHistogram
                  endingValues={endingValues}
                  trialsRun={summary.trialsRun}
                  requiredMinimumAssetLevel={meta.requiredMinimumAssetLevel}
                  startingLiquidBalance={meta.startingLiquidBalance}
                  variant="compact"
                  onPromote={() => setMainChart("histogram")}
                />
              )}
              {mainChart !== "longevity" && (
                <LongevityChart
                  byYearLiquidAssetsPerTrial={lastResult.byYearLiquidAssetsPerTrial}
                  requiredMinimumAssetLevel={meta.requiredMinimumAssetLevel}
                  planStartYear={meta.planStartYear}
                  clientBirthYear={meta.clientBirthYear}
                  variant="compact"
                  onPromote={() => setMainChart("longevity")}
                />
              )}
              <RecommendationsCard />
            </>
          ) : (
            <>
              <div className="rounded-lg bg-card ring-1 ring-hair h-[120px] animate-pulse" />
              <div className="rounded-lg bg-card ring-1 ring-hair h-[260px] animate-pulse" />
              <div className="rounded-lg bg-card ring-1 ring-hair h-[280px] animate-pulse" />
              <div className="rounded-lg bg-card ring-1 ring-hair h-[140px] animate-pulse" />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

