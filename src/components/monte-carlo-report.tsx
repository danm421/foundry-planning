"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ReportHeader } from "./monte-carlo/report-header";
import { KpiBand } from "./monte-carlo/kpi-band";
import { FanChart } from "./monte-carlo/fan-chart";
import { FindingsCard } from "./monte-carlo/findings-card";
import { RecommendationsCard } from "./monte-carlo/recommendations-card";
import { TerminalHistogram } from "./monte-carlo/terminal-histogram";
import { LongevityChart } from "./monte-carlo/longevity-chart";
import { YearlyBreakdown } from "./monte-carlo/yearly-breakdown";
import {
  createReturnEngine,
  runMonteCarlo,
  summarizeMonteCarlo,
  runProjection,
  liquidPortfolioTotal,
  type ClientData,
  type MonteCarloSummary,
  type MonteCarloResult,
  type AccountAssetMix,
  type IndexInput,
} from "@/engine";

interface Props {
  clientId: string;
  /**
   * Scenario id to load. Phase ε will thread this through the
   * /api/clients/[id]/projection-data + /monte-carlo-data fetches; for now
   * the prop is accepted but unused so the page handler can pass `?scenario=`.
   */
  scenarioId?: string | "base";
}

interface MonteCarloPayload {
  indices: IndexInput[];
  correlation: number[][];
  accountMixes: Array<{ accountId: string; mix: AccountAssetMix[] }>;
  startingLiquidBalance: number;
  seed: number;
  requiredMinimumAssetLevel: number;
}


export default function MonteCarloReport({ clientId }: Props) {
  const searchParams = useSearchParams();
  const [clientData, setClientData] = useState<ClientData | null>(null);
  const [mcPayload, setMcPayload] = useState<MonteCarloPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Run state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [summary, setSummary] = useState<MonteCarloSummary | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [currentSeed, setCurrentSeed] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<MonteCarloResult | null>(null);
  const [mainChart, setMainChart] = useState<"fan" | "histogram" | "longevity">("fan");

  // Load data in parallel. This is the same pattern as the CashFlow report;
  // MC just needs an additional payload (correlations, mixes, seed).
  //
  // The Next.js App Router keeps this page component mounted across
  // /clients/[id]/... param changes, so changing clientId doesn't unmount us.
  // Reset every piece of per-client state synchronously when clientId changes
  // — otherwise the previous client's summary, KPIs, table, error, and seed
  // linger in the UI until the new fetch resolves (and `summary` would never
  // clear at all without an explicit re-run).
  useEffect(() => {
    setClientData(null);
    setMcPayload(null);
    setLoadError(null);
    setSummary(null);
    setLastResult(null);
    setRunError(null);
    setCurrentSeed(null);
    setProgress(0);
    setProgressTotal(0);
    setRunning(false);

    let cancelled = false;
    (async () => {
      try {
        const scenarioParam = searchParams?.get("scenario");
        const projUrl = scenarioParam
          ? `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(scenarioParam)}`
          : `/api/clients/${clientId}/projection-data`;
        const [projRes, mcRes] = await Promise.all([
          fetch(projUrl),
          fetch(`/api/clients/${clientId}/monte-carlo-data`),
        ]);
        if (!projRes.ok) throw new Error(`projection-data: HTTP ${projRes.status}`);
        if (!mcRes.ok) throw new Error(`monte-carlo-data: HTTP ${mcRes.status}`);
        const [projData, mcData] = await Promise.all([projRes.json(), mcRes.json()]);
        if (cancelled) return;
        setClientData(projData as ClientData);
        setMcPayload(mcData as MonteCarloPayload);
        setCurrentSeed((mcData as MonteCarloPayload).seed);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, searchParams]);

  const handleRun = useCallback(async () => {
    if (!clientData || !mcPayload) return;
    setRunning(true);
    setRunError(null);
    setSummary(null);
    setProgress(0);
    setProgressTotal(1000);

    try {
      const engine = createReturnEngine({
        indices: mcPayload.indices,
        correlation: mcPayload.correlation,
        seed: mcPayload.seed,
      });
      const accountMixes = new Map(mcPayload.accountMixes.map((a) => [a.accountId, a.mix]));

      const result = await runMonteCarlo({
        data: clientData,
        returnEngine: engine,
        accountMixes,
        trials: 1000,
        requiredMinimumAssetLevel: mcPayload.requiredMinimumAssetLevel,
        onProgress: (done, total) => {
          setProgress(done);
          setProgressTotal(total);
        },
      });

      const s = summarizeMonteCarlo(result, {
        client: clientData.client,
        planSettings: clientData.planSettings,
        startingLiquidBalance: mcPayload.startingLiquidBalance,
      });
      setLastResult(result);
      setSummary(s);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [clientData, mcPayload]);

  const handleRestart = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/monte-carlo-data`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { seed: number };
      // Update mcPayload with a new object reference so the auto-run effect
      // below picks up the change and kicks off a fresh run with the new seed.
      setMcPayload((prev) => (prev ? { ...prev, seed: body.seed } : prev));
      setCurrentSeed(body.seed);
      setSummary(null);
      setRunError(null);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    }
  }, [clientId]);

  // Auto-run MC as soon as data is loaded (or reloaded after a reseed).
  // Guarded on `summary` and `running` so it fires exactly once per
  // (clientData, mcPayload) pair — not on every re-render.
  useEffect(() => {
    if (!clientData || !mcPayload) return;
    if (summary !== null) return;
    if (running) return;
    if (runError !== null) return;
    handleRun();
  }, [clientData, mcPayload, summary, running, runError, handleRun]);

  const deterministic = useMemo(() => {
    if (!clientData) return undefined;
    try {
      // runProjection returns ProjectionYear[] directly (not an object with a
      // `years` property) — see src/engine/projection.ts:114.
      const years = runProjection(clientData);
      return years.map(liquidPortfolioTotal);
    } catch {
      return undefined;
    }
  }, [clientData]);

  const ageMarkers = useMemo(() => {
    if (!clientData) return [];
    const c = clientData.client;
    const markers: Array<{ age: number; label: string; color: string }> = [
      { age: c.retirementAge, label: `Retire ${c.retirementAge}`, color: "rgb(110, 231, 183)" },
    ];
    if (c.spouseRetirementAge != null && c.spouseRetirementAge !== c.retirementAge) {
      markers.push({
        age: c.spouseRetirementAge,
        label: `Spouse ${c.spouseRetirementAge}`,
        color: "rgb(125, 211, 252)", // sky-300 — Timeline's "life" color
      });
    }
    return markers;
  }, [clientData]);

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
        <div className="text-red-600">Failed to load: {loadError}</div>
      </div>
    );
  }

  if (!clientData || !mcPayload) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold mb-2">Monte Carlo Simulation</h1>
        <div className="text-gray-400">Loading plan data…</div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6">
        <div className="flex flex-col gap-6 min-w-0">
          <ReportHeader
            clientDisplayName={
              clientData.client.spouseName
                ? `${clientData.client.firstName} & ${clientData.client.spouseName} ${clientData.client.lastName}`
                : `${clientData.client.firstName} ${clientData.client.lastName}`
            }
          />
          {summary ? (
            <KpiBand
              summary={summary}
              clientData={clientData}
              planSettings={clientData.planSettings}
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={`rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4 min-h-[96px] animate-pulse${i === 0 ? " lg:col-span-2" : ""}`}
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
                  requiredMinimumAssetLevel={mcPayload.requiredMinimumAssetLevel}
                  startingLiquidBalance={mcPayload.startingLiquidBalance}
                  variant="main"
                />
              )}
              {mainChart === "longevity" && (
                <LongevityChart
                  byYearLiquidAssetsPerTrial={lastResult.byYearLiquidAssetsPerTrial}
                  requiredMinimumAssetLevel={mcPayload.requiredMinimumAssetLevel}
                  planStartYear={clientData.planSettings.planStartYear}
                  clientBirthYear={
                    clientData.client.dateOfBirth
                      ? parseInt(clientData.client.dateOfBirth.slice(0, 4), 10) || undefined
                      : undefined
                  }
                  variant="main"
                />
              )}
            </>
          ) : (
            <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[440px] animate-pulse" />
          )}

          {runError && (
            <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
              Run failed: {runError}
            </div>
          )}

          {summary ? (
            <YearlyBreakdown summary={summary} />
          ) : (
            <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[320px] animate-pulse" />
          )}

          {summary ? (
            <div className="flex justify-center pt-2">
              <button
                onClick={handleRestart}
                disabled={running}
                className="rounded-lg border border-slate-700 bg-slate-900/60 px-4 py-2 text-sm text-slate-200 hover:border-emerald-400/60 hover:text-emerald-300 disabled:opacity-50"
              >
                {running ? "Running…" : "Generate New Seed"}
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
                  requiredMinimumAssetLevel={mcPayload.requiredMinimumAssetLevel}
                  startingLiquidBalance={mcPayload.startingLiquidBalance}
                  variant="compact"
                  onPromote={() => setMainChart("histogram")}
                />
              )}
              {mainChart !== "longevity" && (
                <LongevityChart
                  byYearLiquidAssetsPerTrial={lastResult.byYearLiquidAssetsPerTrial}
                  requiredMinimumAssetLevel={mcPayload.requiredMinimumAssetLevel}
                  planStartYear={clientData.planSettings.planStartYear}
                  clientBirthYear={
                    clientData.client.dateOfBirth
                      ? parseInt(clientData.client.dateOfBirth.slice(0, 4), 10) || undefined
                      : undefined
                  }
                  variant="compact"
                  onPromote={() => setMainChart("longevity")}
                />
              )}
              <RecommendationsCard />
            </>
          ) : (
            <>
              <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[120px] animate-pulse" />
              <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[260px] animate-pulse" />
              <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[280px] animate-pulse" />
              <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[140px] animate-pulse" />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

