"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReportHeader } from "./monte-carlo/report-header";
import { KpiBand } from "./monte-carlo/kpi-band";
import { FanChart } from "./monte-carlo/fan-chart";
import { FindingsCard } from "./monte-carlo/findings-card";
import { TopRisksCard } from "./monte-carlo/top-risks-card";
import { RecommendationsCard } from "./monte-carlo/recommendations-card";
import { computeTopRisks } from "./monte-carlo/lib/top-risks";
import {
  createReturnEngine,
  runMonteCarlo,
  summarizeMonteCarlo,
  runProjection,
  liquidPortfolioTotal,
  type ClientData,
  type MonteCarloSummary,
  type AccountAssetMix,
  type IndexInput,
} from "@/engine";

interface Props {
  clientId: string;
}

interface MonteCarloPayload {
  indices: IndexInput[];
  correlation: number[][];
  accountMixes: Array<{ accountId: string; mix: AccountAssetMix[] }>;
  startingLiquidBalance: number;
  seed: number;
  requiredMinimumAssetLevel: number;
}

// Coarse format helpers — the v1 proof-of-life UI uses just these two.
function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${value < 0 ? "-" : ""}$${(abs / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatPercent(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export default function MonteCarloReport({ clientId }: Props) {
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
    setRunError(null);
    setCurrentSeed(null);
    setProgress(0);
    setProgressTotal(0);
    setRunning(false);

    let cancelled = false;
    (async () => {
      try {
        const [projRes, mcRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/projection-data`),
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
  }, [clientId]);

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

  const topRisks = useMemo(() => {
    if (!summary || !clientData) return [];
    return computeTopRisks(summary, clientData, clientData.planSettings);
  }, [summary, clientData]);

  const deterministicEnding = deterministic?.[deterministic.length - 1];

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
        <div className="text-gray-500">Loading plan data…</div>
      </div>
    );
  }

  const usedCount = mcPayload.indices.length;
  const mixCount = mcPayload.accountMixes.length;

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
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className={`rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4 min-h-[96px] animate-pulse${i === 0 ? " lg:col-span-2" : ""}`}
                />
              ))}
            </div>
          )}

          {summary ? (
            <FanChart
              summary={summary}
              deterministic={deterministic}
              ageMarkers={ageMarkers}
            />
          ) : (
            <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[440px] animate-pulse" />
          )}

          {usedCount === 0 && (
            <div className="rounded border border-gray-300 bg-gray-50 p-3 text-sm text-gray-700">
              All accounts in this plan use fixed growth rates (custom, default, or inflation).
              Monte Carlo will run, but every trial produces the same result and the output
              matches the deterministic Cash Flow projection.
            </div>
          )}

          {running && (
            <div className="w-full max-w-md">
              <div className="h-2 bg-gray-200 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-600 transition-all"
                  style={{ width: `${progressTotal > 0 ? (progress / progressTotal) * 100 : 0}%` }}
                />
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {progress} / {progressTotal} trials
              </div>
            </div>
          )}

          {runError && (
            <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
              Run failed: {runError}
            </div>
          )}

          {summary && (
            <>
              <section className="space-y-3">
                <h2 className="text-lg font-semibold">Monte Carlo Asset Spread</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="py-2 pr-4">Year</th>
                        <th className="py-2 pr-4">Age</th>
                        <th className="py-2 pr-4 text-right">Above Avg. Market (80%)</th>
                        <th className="py-2 pr-4 text-right">CAGR</th>
                        <th className="py-2 pr-4 text-right">Average Market (50%)</th>
                        <th className="py-2 pr-4 text-right">CAGR</th>
                        <th className="py-2 pr-4 text-right">Below Avg. Market (20%)</th>
                        <th className="py-2 pr-4 text-right">CAGR</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summary.byYear.map((row) => (
                        <tr key={row.year} className="border-b">
                          <td className="py-2 pr-4">{row.year}</td>
                          <td className="py-2 pr-4">
                            {row.age.spouse != null
                              ? `${row.age.client}/${row.age.spouse}`
                              : row.age.client}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono">{formatCurrency(row.balance.p80)}</td>
                          <td className="py-2 pr-4 text-right font-mono text-gray-500">
                            {row.cagrFromStart ? formatPercent(row.cagrFromStart.p80) : "—"}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono">{formatCurrency(row.balance.p50)}</td>
                          <td className="py-2 pr-4 text-right font-mono text-gray-500">
                            {row.cagrFromStart ? formatPercent(row.cagrFromStart.p50) : "—"}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono">{formatCurrency(row.balance.p20)}</td>
                          <td className="py-2 pr-4 text-right font-mono text-gray-500">
                            {row.cagrFromStart ? formatPercent(row.cagrFromStart.p20) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
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
          {summary ? (
            <>
              <FindingsCard summary={summary} deterministicEnding={deterministicEnding} />
              <TopRisksCard risks={topRisks} />
              <RecommendationsCard />
            </>
          ) : (
            <>
              <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[140px] animate-pulse" />
              <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[100px] animate-pulse" />
              <div className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 h-[140px] animate-pulse" />
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

