"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { TrashIcon } from "@/components/icons";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TickerHolding {
  id: string;
  displayTicker: string;
  weight: string;
  securityId: string | null;
}

interface TickerPortfolio {
  id: string;
  name: string;
  description: string | null;
  holdings: TickerHolding[];
}

interface PortfolioStats {
  stats: {
    annArithMean: number;
    annGeoReturn: number;
    annVolatility: number;
    downsideDeviation: number;
    sharpe: number;
    sortino: number;
    maxDrawdown: number;
    nMonths: number;
  };
  window: {
    windowStart: string | null;
    windowEnd: string | null;
    nMonths: number;
    limitingTicker: string | null;
    insufficientHistory: boolean;
    shortHistory: boolean;
  };
  lookThrough: {
    allocation: Array<{ slug: string; weight: number }>;
    tax: {
      pctOrdinaryIncome: number;
      pctLtCapitalGains: number;
      pctQualifiedDividends: number;
      pctTaxExempt: number;
    };
    unclassifiedWeight: number;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function prettifySlug(slug: string): string {
  return slug
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── MetricCard ────────────────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-3">{label}</p>
      <p className="text-lg font-semibold text-ink tabular-nums">{value}</p>
    </div>
  );
}

// ── FundHoldingsEditor ────────────────────────────────────────────────────────

interface HoldingRow {
  _key: number; // stable per-row identity for React reconciliation
  displayTicker: string;
  weight: string; // stored as display % (e.g. "60.00")
}

function FundHoldingsEditor({
  portfolioId,
  initialHoldings,
  onSaved,
}: {
  portfolioId: string;
  initialHoldings: TickerHolding[];
  onSaved: () => void;
}) {
  const nextKey = useRef(0);
  const makeRows = useCallback(
    (holdings: TickerHolding[]): HoldingRow[] =>
      holdings.map((h) => ({
        _key: nextKey.current++,
        displayTicker: h.displayTicker,
        weight: (Number(h.weight) * 100).toFixed(2),
      })),
    []
  );

  const [rows, setRows] = useState<HoldingRow[]>(() => makeRows(initialHoldings));
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset when the selected portfolio changes. Depend only on portfolioId —
  // initialHoldings is a new array reference on every parent render (portfolios
  // state is replaced wholesale), so including it would reset mid-edit on any
  // unrelated re-render.
  useEffect(() => {
    setRows(makeRows(initialHoldings));
    setSaveError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: see comment above
  }, [portfolioId]);

  const currentTotal = rows.reduce((s, r) => s + Number(r.weight), 0);
  const isValid = Math.abs(currentTotal - 100) < 0.1;

  function addRow() {
    setRows((prev) => [...prev, { _key: nextKey.current++, displayTicker: "", weight: "0" }]);
  }

  function removeRow(key: number) {
    setRows((prev) => prev.filter((r) => r._key !== key));
  }

  function updateTicker(key: number, value: string) {
    setRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, displayTicker: value } : r))
    );
  }

  function updateWeight(key: number, value: string) {
    setRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, weight: value } : r))
    );
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/cma/ticker-portfolios/${portfolioId}/holdings`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            holdings: rows.map((r) => ({
              displayTicker: r.displayTicker.toUpperCase().trim(),
              weight: Number(r.weight) / 100,
            })),
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Save failed");
      }
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {saveError && (
        <p className="mb-2 rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">
          {saveError}
        </p>
      )}
      <div className="overflow-x-auto rounded-lg border border-hair">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hair bg-card-2/60 text-left text-xs font-medium uppercase tracking-wider text-ink-3">
              <th className="px-3 py-2">Ticker</th>
              <th className="px-3 py-2 text-right">Weight %</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hair">
            {rows.map((r) => (
              <tr key={r._key} className="hover:bg-card-hover">
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={r.displayTicker}
                    onChange={(e) => updateTicker(r._key, e.target.value)}
                    placeholder="e.g. SPY"
                    aria-label="Ticker symbol"
                    className="w-36 rounded border border-hair bg-transparent px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end">
                    <input
                      type="number"
                      step="0.01"
                      value={r.weight}
                      onChange={(e) => updateWeight(r._key, e.target.value)}
                      aria-label="Weight percentage"
                      className="w-24 rounded border border-hair bg-transparent px-2 py-1 text-right text-sm tabular-nums text-ink focus:border-accent focus:outline-none"
                    />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => removeRow(r._key)}
                    className="rounded p-1 text-white hover:bg-white/10 hover:text-white"
                    title="Remove holding"
                    aria-label="Remove holding"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={addRow}
            className="rounded border border-dashed border-hair-2 px-3 py-1.5 text-sm text-ink-2 hover:border-hair hover:text-ink"
          >
            + Add holding
          </button>
          <span
            className={`text-sm tabular-nums ${isValid ? "text-good" : "text-warn"}`}
          >
            Total: {currentTotal.toFixed(2)}%
          </span>
        </div>
        <button
          onClick={handleSave}
          disabled={!isValid || saving}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save Holdings"}
        </button>
      </div>
    </div>
  );
}

// ── FundPortfoliosTab (main export) ───────────────────────────────────────────

export default function FundPortfoliosTab() {
  const [portfolios, setPortfolios] = useState<TickerPortfolio[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stats, setStats] = useState<PortfolioStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [riskFreeRate, setRiskFreeRate] = useState<number>(0.04);
  // Track the name being edited in the rename input
  const [editName, setEditName] = useState<string>("");

  const selected = portfolios.find((p) => p.id === selectedId) ?? null;

  // ── Fetch all portfolios ────────────────────────────────────────────────────
  const fetchPortfolios = useCallback(async () => {
    try {
      const res = await fetch("/api/cma/ticker-portfolios");
      if (res.ok) {
        const data: TickerPortfolio[] = await res.json();
        setPortfolios(data);
        setSelectedId((prev) => {
          // Keep current selection if still valid, else pick first
          if (prev && data.some((p) => p.id === prev)) return prev;
          return data[0]?.id ?? null;
        });
      }
    } catch {
      setError("Failed to load fund portfolios");
    }
  }, []);

  // ── Fetch stats for selected portfolio ─────────────────────────────────────
  // Returns an ignore-setter so callers can cancel the in-flight request if the
  // selection changes before the response arrives (stale-response guard).
  const fetchStats = useCallback(async (portfolioId: string, signal?: AbortSignal) => {
    setStatsLoading(true);
    setStats(null);
    try {
      const res = await fetch(
        `/api/cma/ticker-portfolios/${portfolioId}/stats`,
        { signal }
      );
      if (res.ok) {
        const data: PortfolioStats = await res.json();
        setStats(data);
      }
    } catch (err) {
      // Abort errors are expected when the selection changes mid-flight.
      if (err instanceof Error && err.name === "AbortError") return;
      // Other failures: fail-soft — stats panel just stays empty.
    } finally {
      setStatsLoading(false);
    }
  }, []);

  // ── Mount: load portfolios + settings ──────────────────────────────────────
  useEffect(() => {
    void fetchPortfolios();
    fetch("/api/cma/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setRiskFreeRate(d.riskFreeRate); })
      .catch(() => {/* fail-soft */});
  }, [fetchPortfolios]);

  // ── When selected portfolio changes, load stats + sync rename input ─────────
  useEffect(() => {
    if (!selectedId) {
      setStats(null);
      setEditName("");
      return;
    }
    const p = portfolios.find((x) => x.id === selectedId);
    setEditName(p?.name ?? "");
    if (p && p.holdings.length > 0) {
      // Abort any in-flight request from the previous selection so stale
      // responses don't overwrite stats for the newly-selected portfolio.
      const controller = new AbortController();
      void fetchStats(selectedId, controller.signal);
      return () => controller.abort();
    } else {
      setStats(null);
    }
  }, [selectedId, portfolios, fetchStats]);

  // ── CRUD helpers ────────────────────────────────────────────────────────────
  async function addPortfolio() {
    try {
      const res = await fetch("/api/cma/ticker-portfolios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Portfolio" }),
      });
      if (res.ok) {
        const created: TickerPortfolio = await res.json();
        await fetchPortfolios();
        setSelectedId(created.id);
      }
    } catch {
      setError("Failed to create portfolio");
    }
  }

  async function deletePortfolio(id: string) {
    try {
      await fetch(`/api/cma/ticker-portfolios/${id}`, { method: "DELETE" });
      if (selectedId === id) setSelectedId(null);
      await fetchPortfolios();
    } catch {
      setError("Failed to delete portfolio");
    }
  }

  async function renamePortfolio(id: string, name: string) {
    if (!name.trim()) return;
    try {
      const res = await fetch(`/api/cma/ticker-portfolios/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (res.ok) await fetchPortfolios();
    } catch {
      // Fail-soft — the local state still shows updated name
    }
  }

  async function updateRiskFreeRate(value: number) {
    try {
      await fetch("/api/cma/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ riskFreeRate: value }),
      });
      if (selectedId) void fetchStats(selectedId);
    } catch {
      // Fail-soft
    }
  }

  // After holdings saved: refresh list then refetch stats
  async function handleHoldingsSaved() {
    await fetchPortfolios();
    if (selectedId) void fetchStats(selectedId);
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-6">
      {/* Left list */}
      <div className="w-56 flex-shrink-0 space-y-2">
        {portfolios.map((p) => (
          <div
            key={p.id}
            onClick={() => setSelectedId(p.id)}
            className={`cursor-pointer rounded-lg border px-3 py-2 text-sm ${
              selectedId === p.id
                ? "border-accent bg-accent/10 text-accent-ink"
                : "border-hair text-ink-2 hover:border-hair-2"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="truncate font-medium">{p.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deletePortfolio(p.id);
                }}
                className="rounded p-1 text-white hover:bg-white/10 hover:text-white"
                title="Delete portfolio"
                aria-label="Delete portfolio"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
        <button
          onClick={addPortfolio}
          className="w-full rounded-lg border border-dashed border-hair-2 px-3 py-2 text-sm text-ink-2 hover:border-hair hover:text-ink-2"
        >
          + New Portfolio
        </button>
        {portfolios.length === 0 && (
          <p className="text-xs text-ink-3">
            No fund portfolios yet. Create one to get started.
          </p>
        )}
      </div>

      {/* Detail pane */}
      {selected && (
        <div className="flex-1 space-y-4">
          {error && (
            <p className="rounded bg-red-900/50 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          )}

          {/* Header: rename + risk-free rate */}
          <div className="flex items-center gap-4">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => renamePortfolio(selected.id, editName)}
              aria-label="Portfolio name"
              className="flex-1 rounded border border-hair bg-transparent px-2 py-1 text-sm font-medium text-ink focus:border-accent focus:outline-none"
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <label
                htmlFor="rfr-input"
                className="text-xs text-ink-3 whitespace-nowrap"
              >
                Risk-free rate %
              </label>
              <input
                id="rfr-input"
                type="number"
                step="0.01"
                min="0"
                max="20"
                value={(riskFreeRate * 100).toFixed(2)}
                onChange={(e) => setRiskFreeRate(Number(e.target.value) / 100)}
                onBlur={(e) => updateRiskFreeRate(Number(e.target.value) / 100)}
                className="w-20 rounded border border-hair bg-transparent px-2 py-1 text-right text-sm tabular-nums text-ink focus:border-accent focus:outline-none"
              />
            </div>
          </div>

          {/* Holdings editor */}
          <FundHoldingsEditor
            portfolioId={selected.id}
            initialHoldings={selected.holdings}
            onSaved={handleHoldingsSaved}
          />

          {/* Stats panel */}
          {selected.holdings.length === 0 ? (
            <p className="text-sm text-ink-3">
              Add holdings to see metrics.
            </p>
          ) : statsLoading ? (
            <p className="text-sm text-ink-3">Computing…</p>
          ) : stats ? (
            <div className="space-y-4">
              {/* Metric cards */}
              <div className="grid grid-cols-3 gap-3 rounded-lg border border-hair bg-card-2/40 p-4">
                <MetricCard
                  label="Ann. Return (Geo)"
                  value={`${(stats.stats.annGeoReturn * 100).toFixed(2)}%`}
                />
                <MetricCard
                  label="Ann. Return (Arith)"
                  value={`${(stats.stats.annArithMean * 100).toFixed(2)}%`}
                />
                <MetricCard
                  label="Volatility"
                  value={`${(stats.stats.annVolatility * 100).toFixed(2)}%`}
                />
                <MetricCard
                  label="Sharpe"
                  value={stats.stats.sharpe.toFixed(2)}
                />
                <MetricCard
                  label="Sortino"
                  value={stats.stats.sortino.toFixed(2)}
                />
                <MetricCard
                  label="Max Drawdown"
                  value={`${(stats.stats.maxDrawdown * 100).toFixed(2)}%`}
                />
              </div>

              {/* Window line */}
              <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                {stats.window.windowStart && stats.window.windowEnd && (
                  <span>
                    Computed over {stats.window.windowStart}–
                    {stats.window.windowEnd} · {stats.window.nMonths} mo
                  </span>
                )}
                {stats.window.insufficientHistory && (
                  <span className="rounded bg-warn/20 px-1.5 py-0.5 text-warn">
                    Insufficient history (&lt;36 mo)
                  </span>
                )}
                {!stats.window.insufficientHistory &&
                  stats.window.shortHistory && (
                    <span className="rounded bg-warn/20 px-1.5 py-0.5 text-warn">
                      Short history (&lt;60 mo)
                    </span>
                  )}
                {stats.window.limitingTicker && (
                  <span>· limited by {stats.window.limitingTicker}</span>
                )}
              </div>

              {/* Look-through panel */}
              {(stats.lookThrough.allocation.length > 0 ||
                stats.lookThrough.unclassifiedWeight > 0.0005) && (
                <div className="rounded-lg border border-hair bg-card-2/40 p-4 space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-ink-3">
                    Asset Class Look-Through
                  </p>
                  <div className="space-y-1.5">
                    {[...stats.lookThrough.allocation]
                      .sort((a, b) => b.weight - a.weight)
                      .map((item) => (
                        <div key={item.slug} className="flex items-center gap-2">
                          <span className="w-36 flex-shrink-0 text-xs text-ink-2 truncate">
                            {prettifySlug(item.slug)}
                          </span>
                          <div className="flex-1 rounded bg-card-2 h-3 overflow-hidden">
                            <div
                              className="h-full rounded bg-accent"
                              style={{ width: `${item.weight * 100}%` }}
                            />
                          </div>
                          <span className="w-12 text-right text-xs tabular-nums text-ink-2">
                            {(item.weight * 100).toFixed(1)}%
                          </span>
                        </div>
                      ))}
                    {stats.lookThrough.unclassifiedWeight > 0.0005 && (
                      <div className="flex items-center gap-2">
                        <span className="w-36 flex-shrink-0 text-xs text-warn truncate">
                          Unclassified
                        </span>
                        <div className="flex-1 rounded bg-card-2 h-3 overflow-hidden">
                          <div
                            className="h-full rounded bg-warn/40"
                            style={{
                              width: `${stats.lookThrough.unclassifiedWeight * 100}%`,
                            }}
                          />
                        </div>
                        <span className="w-12 text-right text-xs tabular-nums text-warn">
                          {(stats.lookThrough.unclassifiedWeight * 100).toFixed(1)}%
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-ink-3 tabular-nums">
                    {stats.lookThrough.unclassifiedWeight > 0.0005 && (
                      <span className="text-warn">(of classified holdings) </span>
                    )}
                    OI{" "}
                    {Math.round(
                      stats.lookThrough.tax.pctOrdinaryIncome * 100
                    )}
                    % · LTCG{" "}
                    {Math.round(
                      stats.lookThrough.tax.pctLtCapitalGains * 100
                    )}
                    % · QualDiv{" "}
                    {Math.round(
                      stats.lookThrough.tax.pctQualifiedDividends * 100
                    )}
                    % · TaxEx{" "}
                    {Math.round(stats.lookThrough.tax.pctTaxExempt * 100)}%
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
