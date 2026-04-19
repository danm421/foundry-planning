"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createReturnEngine,
  runMonteCarlo,
  summarizeMonteCarlo,
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
  useEffect(() => {
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
      setMcPayload((prev) => (prev ? { ...prev, seed: body.seed } : prev));
      setCurrentSeed(body.seed);
      setSummary(null);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    }
  }, [clientId]);

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
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Monte Carlo Simulation</h1>
        <p className="text-sm text-gray-500">
          {usedCount} asset class{usedCount === 1 ? "" : "es"} used ·{" "}
          {mixCount} account{mixCount === 1 ? "" : "s"} randomized · seed{" "}
          <code className="font-mono text-xs">{currentSeed}</code>
        </p>
      </header>

      {usedCount === 0 && (
        <div className="rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          This plan has no accounts with an asset-class allocation or model portfolio,
          so there&apos;s nothing to randomize. Configure at least one investable account
          with a growth source of &quot;Asset Mix&quot; or &quot;Model Portfolio&quot; to
          see Monte Carlo results.
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleRun}
          disabled={running || usedCount === 0}
          className="px-4 py-2 rounded bg-blue-600 text-white disabled:bg-gray-300"
        >
          {running ? "Running…" : summary ? "Re-run" : "Run 1,000 Simulations"}
        </button>
        <button
          onClick={handleRestart}
          disabled={running}
          className="px-4 py-2 rounded border border-gray-300 disabled:text-gray-400"
          title="Generate a fresh seed — subsequent runs produce different numbers"
        >
          Restart (new seed)
        </button>
      </div>

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
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Kpi label="Success Probability" value={formatPercent(summary.successRate, 1)} />
            <Kpi label="Probability of Failure" value={formatPercent(summary.failureRate, 1)} />
            <Kpi label="Median Portfolio Value" value={formatCurrency(summary.ending.p50)} />
            <Kpi label="Simulations" value={summary.trialsRun.toLocaleString()} />
          </div>

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
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-200 p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
