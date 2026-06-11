"use client";

import { useState, useRef } from "react";
import { TrashIcon } from "@/components/icons";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RebalanceTargetValue =
  | { kind: "existing"; portfolioId: string }
  | { kind: "new"; holdings: { ticker: string; weight: number }[]; saveToCma: boolean; name?: string };

export interface RebalanceTargetProps {
  fundPortfolios: { id: string; name: string }[];
  value: RebalanceTargetValue | null;
  onChange: (v: RebalanceTargetValue) => void;
}

// ── Row type (local editor state) ─────────────────────────────────────────────

interface HoldingRow {
  _key: number;
  displayTicker: string;
  weight: string; // display % string e.g. "60.00"
}

// ── RebalanceTarget ────────────────────────────────────────────────────────────

export function RebalanceTarget({ fundPortfolios, value, onChange }: RebalanceTargetProps) {
  const mode: "existing" | "new" = value?.kind === "new" ? "new" : "existing";

  // ── "Build new" local state ────────────────────────────────────────────────
  // nextKey starts at 1 because _key 0 is used by the initial row literal below
  const nextKey = useRef(1);
  const [rows, setRows] = useState<HoldingRow[]>([
    { _key: 0, displayTicker: "", weight: "0" },
  ]);
  const [saveToCma, setSaveToCma] = useState(false);
  const [cmaName, setCmaName] = useState("");

  // ── Helpers ────────────────────────────────────────────────────────────────

  function emitNew(
    nextRows: HoldingRow[],
    nextSave: boolean,
    nextName: string,
  ) {
    onChange({
      kind: "new",
      holdings: nextRows
        .map((r) => ({
          ticker: r.displayTicker.trim().toUpperCase(),
          weight: Number(r.weight) / 100,
        }))
        .filter((h) => h.ticker),
      saveToCma: nextSave,
      name: nextName || undefined,
    });
  }

  function setMode(next: "existing" | "new") {
    if (next === "existing") {
      const first = fundPortfolios[0];
      if (first) onChange({ kind: "existing", portfolioId: first.id });
      // If no portfolios, don't emit — parent will see null
    } else {
      emitNew(rows, saveToCma, cmaName);
    }
  }

  // ── Row mutations ──────────────────────────────────────────────────────────

  function addRow() {
    const next = [...rows, { _key: nextKey.current++, displayTicker: "", weight: "0" }];
    setRows(next);
    emitNew(next, saveToCma, cmaName);
  }

  function removeRow(key: number) {
    const next = rows.filter((r) => r._key !== key);
    setRows(next);
    emitNew(next, saveToCma, cmaName);
  }

  function updateTicker(key: number, val: string) {
    const next = rows.map((r) => (r._key === key ? { ...r, displayTicker: val } : r));
    setRows(next);
    emitNew(next, saveToCma, cmaName);
  }

  function updateWeight(key: number, val: string) {
    const next = rows.map((r) => (r._key === key ? { ...r, weight: val } : r));
    setRows(next);
    emitNew(next, saveToCma, cmaName);
  }

  function handleSaveToCmaChange(checked: boolean) {
    setSaveToCma(checked);
    emitNew(rows, checked, cmaName);
  }

  function handleNameChange(val: string) {
    setCmaName(val);
    emitNew(rows, saveToCma, val);
  }

  // ── Derived ────────────────────────────────────────────────────────────────

  const currentTotal = rows.reduce((s, r) => s + Number(r.weight), 0);
  const isValid = Math.abs(currentTotal - 100) < 0.1;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">Target portfolio</p>

        {/* Segmented mode toggle */}
        <div className="inline-flex rounded-md border border-hair-2 p-0.5">
          <button
            type="button"
            onClick={() => setMode("existing")}
            className={
              mode === "existing"
                ? "rounded bg-card-2 px-3 py-1 text-sm text-ink"
                : "px-3 py-1 text-sm text-ink-3"
            }
          >
            Pick existing
          </button>
          <button
            type="button"
            onClick={() => setMode("new")}
            className={
              mode === "new"
                ? "rounded bg-card-2 px-3 py-1 text-sm text-ink"
                : "px-3 py-1 text-sm text-ink-3"
            }
          >
            Build new
          </button>
        </div>
      </div>

      {/* ── Pick existing ── */}
      {mode === "existing" && (
        <>
          {fundPortfolios.length === 0 ? (
            <p className="text-sm text-ink-3">
              No fund portfolios yet — build one below.
            </p>
          ) : (
            <select
              value={value?.kind === "existing" ? value.portfolioId : (fundPortfolios[0]?.id ?? "")}
              onChange={(e) => onChange({ kind: "existing", portfolioId: e.target.value })}
              className="w-full rounded border border-hair bg-transparent px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {fundPortfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </>
      )}

      {/* ── Build new ── */}
      {mode === "new" && (
        <div className="space-y-3">
          {/* Holdings table */}
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
                  <tr key={r._key}>
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
                        type="button"
                        onClick={() => removeRow(r._key)}
                        className="rounded p-1 text-ink-3 hover:bg-card-2 hover:text-ink"
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

          {/* Add row + total */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={addRow}
              className="rounded border border-dashed border-hair-2 px-3 py-1.5 text-sm text-ink-2 hover:border-hair hover:text-ink"
            >
              + Add holding
            </button>
            <span className={`text-sm tabular-nums ${isValid ? "text-good" : "text-warn"}`}>
              Total: {currentTotal.toFixed(2)}%
            </span>
          </div>

          {/* Save to CMAs checkbox */}
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={saveToCma}
              onChange={(e) => handleSaveToCmaChange(e.target.checked)}
              className="rounded border-hair accent-accent"
            />
            <span className="text-sm text-ink">Save to CMAs</span>
          </label>

          {/* Portfolio name input (shown when saveToCma is checked) */}
          {saveToCma && (
            <div className="space-y-1">
              <label className="text-xs text-ink-3">Portfolio name</label>
              <input
                type="text"
                value={cmaName}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. 60/40 Core"
                className="w-full rounded border border-hair bg-transparent px-2 py-1 text-sm text-ink focus:border-accent focus:outline-none"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
