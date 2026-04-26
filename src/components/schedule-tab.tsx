"use client";

import { useState, useEffect } from "react";
import type { ScheduleEntry } from "@/lib/schedule-utils";
import { fillFlat, fillGrowth, fillStep } from "@/lib/schedule-utils";

interface ScheduleTabProps {
  startYear: number;
  endYear: number;
  initialOverrides: ScheduleEntry[];
  onSave: (overrides: ScheduleEntry[]) => Promise<void>;
  onClear: () => Promise<void>;
}

type FillMode = "flat" | "growth" | "step";

const fmt = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);

export default function ScheduleTab({
  startYear,
  endYear,
  initialOverrides,
  onSave,
  onClear,
}: ScheduleTabProps) {
  const buildGrid = (overrides: ScheduleEntry[]): Map<number, number> => {
    const map = new Map<number, number>();
    for (let y = startYear; y <= endYear; y++) map.set(y, 0);
    for (const o of overrides) map.set(o.year, o.amount);
    return map;
  };

  const [grid, setGrid] = useState(() => buildGrid(initialOverrides));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fillMode, setFillMode] = useState<FillMode>("flat");

  const [flatAmount, setFlatAmount] = useState("");
  const [growthStart, setGrowthStart] = useState("");
  const [growthRate, setGrowthRate] = useState("");
  const [stepFrom, setStepFrom] = useState(String(startYear));
  const [stepTo, setStepTo] = useState(String(endYear));
  const [stepAmount, setStepAmount] = useState("");

  useEffect(() => {
    setGrid(buildGrid(initialOverrides));
  }, [startYear, endYear]);

  const updateCell = (year: number, value: string) => {
    const num = value === "" ? 0 : parseFloat(value);
    if (isNaN(num)) return;
    setGrid((prev) => {
      const next = new Map(prev);
      next.set(year, num);
      return next;
    });
    setDirty(true);
  };

  const applyFill = () => {
    let entries: ScheduleEntry[];
    switch (fillMode) {
      case "flat":
        entries = fillFlat(startYear, endYear, parseFloat(flatAmount) || 0);
        break;
      case "growth":
        entries = fillGrowth(
          startYear,
          endYear,
          parseFloat(growthStart) || 0,
          (parseFloat(growthRate) || 0) / 100
        );
        break;
      case "step":
        entries = fillStep(
          startYear,
          endYear,
          parseInt(stepFrom) || startYear,
          parseInt(stepTo) || endYear,
          parseFloat(stepAmount) || 0
        );
        break;
    }
    setGrid(buildGrid(entries));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const overrides: ScheduleEntry[] = [];
      for (const [year, amount] of grid) {
        if (year >= startYear && year <= endYear) {
          overrides.push({ year, amount });
        }
      }
      await onSave(overrides);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await onClear();
      setGrid(buildGrid([]));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const years = Array.from(grid.entries())
    .filter(([y]) => y >= startYear && y <= endYear)
    .sort(([a], [b]) => a - b);

  const total = years.reduce((sum, [, amt]) => sum + amt, 0);

  const inputClass =
    "w-full rounded-md border border-gray-600 bg-gray-800 px-3 py-1.5 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";
  const smallInputClass =
    "w-24 rounded-md border border-gray-600 bg-gray-800 px-2 py-1 text-sm text-gray-100 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

  return (
    <div className="flex flex-col gap-4">
      {/* Prefill calculator */}
      <div className="rounded-md border border-gray-700 bg-gray-800/50 p-3">
        <div className="mb-2 flex gap-1">
          {(["flat", "growth", "step"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setFillMode(m)}
              className={`rounded-md px-3 py-1 text-xs font-medium capitalize ${
                fillMode === m
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          {fillMode === "flat" && (
            <label className="flex-1 text-xs text-gray-300">
              Amount
              <input
                type="number"
                min="0"
                step="1"
                value={flatAmount}
                onChange={(e) => setFlatAmount(e.target.value)}
                className={inputClass}
                placeholder="$50,000"
              />
            </label>
          )}
          {fillMode === "growth" && (
            <>
              <label className="flex-1 text-xs text-gray-300">
                Start
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={growthStart}
                  onChange={(e) => setGrowthStart(e.target.value)}
                  className={inputClass}
                  placeholder="$100,000"
                />
              </label>
              <label className="w-20 text-xs text-gray-300">
                Rate %
                <input
                  type="number"
                  min="0"
                  max="30"
                  step="0.1"
                  value={growthRate}
                  onChange={(e) => setGrowthRate(e.target.value)}
                  className={inputClass}
                  placeholder="3"
                />
              </label>
            </>
          )}
          {fillMode === "step" && (
            <>
              <label className="w-20 text-xs text-gray-300">
                From
                <input
                  type="number"
                  value={stepFrom}
                  onChange={(e) => setStepFrom(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="w-20 text-xs text-gray-300">
                To
                <input
                  type="number"
                  value={stepTo}
                  onChange={(e) => setStepTo(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="flex-1 text-xs text-gray-300">
                Amount
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={stepAmount}
                  onChange={(e) => setStepAmount(e.target.value)}
                  className={inputClass}
                  placeholder="$25,000"
                />
              </label>
            </>
          )}
          <button
            type="button"
            onClick={applyFill}
            className="rounded-md bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-500"
          >
            Apply
          </button>
        </div>
      </div>

      {/* Year grid */}
      <div className="max-h-72 overflow-y-auto rounded-md border border-gray-700">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-800 text-gray-300">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Year</th>
              <th className="px-3 py-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {years.map(([year, amount]) => (
              <tr key={year} className="border-t border-gray-800">
                <td className="px-3 py-1 text-gray-300">{year}</td>
                <td className="px-3 py-1 text-right">
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={amount || ""}
                    onChange={(e) => updateCell(year, e.target.value)}
                    className={smallInputClass + " text-right"}
                    placeholder="0"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-gray-600 bg-gray-800/50">
            <tr>
              <td className="px-3 py-1.5 font-medium text-gray-300">Total</td>
              <td className="px-3 py-1.5 text-right font-medium text-gray-100">{fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={handleClear}
          disabled={saving}
          className="rounded-md border border-red-700 bg-red-900/30 px-3 py-1.5 text-xs font-medium text-red-400 hover:bg-red-900/60 disabled:opacity-50"
        >
          Clear Schedule
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving\u2026" : "Save Schedule"}
        </button>
      </div>
    </div>
  );
}
