"use client";

import { useMemo, useState } from "react";
import { PortfolioAnalysisScatter } from "./portfolio-analysis-scatter";
import { AddToChartButton } from "./portfolio-analysis-picker";
import { SERIES, labelForType, buildColorMap } from "./portfolio-analysis-series";
import { HelpTip } from "@/components/help-tip";
import type { AnalysisRow } from "@/lib/investments/portfolio-analysis";
import { useAnalysisSelection } from "@/hooks/use-analysis-selection";

// Categories pre-plotted on first load.
const DEFAULT_CATEGORY_IDS = new Set(["taxable", "retirement"]);

function defaultSelection(rows: AnalysisRow[]): Set<string> {
  return new Set(
    rows.filter((r) => r.type === "category" && DEFAULT_CATEGORY_IDS.has(r.id)).map((r) => r.key),
  );
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const money = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type SortKey = "name" | "arithmeticMean" | "geometricReturn" | "stdDev" | "sharpe" | "value";

export default function PortfolioAnalysisClient({
  clientId,
  analysisRows,
}: {
  clientId: string;
  analysisRows: AnalysisRow[];
}) {
  const availableKeys = useMemo(() => new Set(analysisRows.map((r) => r.key)), [analysisRows]);
  const defaultKeys = useMemo(() => defaultSelection(analysisRows), [analysisRows]);
  const { selectedKeys, add, remove, clear } = useAnalysisSelection(clientId, availableKeys, defaultKeys);
  const [sortKey, setSortKey] = useState<SortKey>("stdDev");
  const [asc, setAsc] = useState(true);

  const visible = useMemo(
    () => analysisRows.filter((r) => selectedKeys.has(r.key)),
    [analysisRows, selectedKeys],
  );

  // One color per plotted item, keyed by row.key so chart, legend, table, and
  // selected list all match.
  const colorMap = useMemo(() => buildColorMap(visible), [visible]);

  // Selected rows for the list display, grouped by series order then name.
  const selectedList = useMemo(() => {
    const typeOrder = new Map(SERIES.map((s, i) => [s.type, i]));
    return [...visible].sort(
      (a, b) =>
        (typeOrder.get(a.type) ?? 0) - (typeOrder.get(b.type) ?? 0) ||
        a.name.localeCompare(b.name),
    );
  }, [visible]);

  const sorted = useMemo(() => {
    const dir = asc ? 1 : -1;
    return [...visible].sort((a, b) => {
      const get = (r: AnalysisRow): number | string => {
        switch (sortKey) {
          case "name":
            return r.name;
          case "arithmeticMean":
            return r.stats.arithmeticMean;
          case "geometricReturn":
            return r.stats.geometricReturn;
          case "stdDev":
            return r.stats.stdDev;
          case "sharpe":
            return r.stats.sharpe ?? -Infinity;
          case "value":
            return r.value ?? -Infinity;
        }
      };
      const av = get(a);
      const bv = get(b);
      if (typeof av === "string" && typeof bv === "string") return av.localeCompare(bv) * dir;
      return ((av as number) - (bv as number)) * dir;
    });
  }, [visible, sortKey, asc]);

  const sortBtn = (key: SortKey, label: string) => (
    <button
      type="button"
      className="text-left font-medium"
      onClick={() => {
        if (sortKey === key) {
          setAsc((v) => !v);
        } else {
          setSortKey(key);
          setAsc(true);
        }
      }}
    >
      {label}
      {sortKey === key ? (asc ? " ▲" : " ▼") : ""}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-[460px]">
          <PortfolioAnalysisScatter rows={visible} colorMap={colorMap} />
        </div>

        <div className="flex h-[460px] flex-col gap-3">
          <div className="flex items-center gap-3">
            <AddToChartButton
              rows={analysisRows}
              selectedKeys={selectedKeys}
              onAdd={(key) => add([key])}
              onAddMany={add}
            />
            {visible.length > 0 && (
              <button
                type="button"
                onClick={clear}
                className="text-sm text-ink-3 hover:text-ink underline-offset-2 hover:underline"
              >
                Clear all
              </button>
            )}
          </div>

          {selectedList.length === 0 ? (
            <p className="text-sm text-ink-4">Nothing plotted yet — use “Add to chart” to pick what to show.</p>
          ) : (
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
              {selectedList.map((r) => (
                <li
                  key={r.key}
                  className="flex items-center justify-between gap-3 rounded border border-hair px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: colorMap.get(r.key) }}
                    />
                    <span className="truncate text-ink">{r.name}</span>
                    <span className="shrink-0 text-xs text-ink-4">{labelForType(r.type)}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(r.key)}
                    aria-label={`Remove ${r.name}`}
                    className="shrink-0 text-ink-4 transition-colors hover:text-ink"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 text-left">{sortBtn("name", "Name")}</th>
            <th className="py-2 text-left">Type</th>
            <th className="py-2 text-right">
              <span className="inline-flex items-center gap-1">
                {sortBtn("geometricReturn", "Return")}
                <HelpTip text="Geometric (compound) annual return — the growth rate actually realized over time once volatility drag is accounted for. This is the return used for straight-line cash-flow projections." />
              </span>
            </th>
            <th className="py-2 text-right">
              <span className="inline-flex items-center gap-1">
                {sortBtn("arithmeticMean", "Mean")}
                <HelpTip text="Arithmetic mean of annual returns — the simple average expected return in any given year. Used as the return input for Monte Carlo simulation." />
              </span>
            </th>
            <th className="py-2 text-right">
              <span className="inline-flex items-center gap-1">
                {sortBtn("stdDev", "Std Dev")}
                <HelpTip text="Standard deviation of annual returns — how much returns swing year to year (volatility, i.e. risk). Used as the volatility input for Monte Carlo simulation." />
              </span>
            </th>
            <th className="py-2 text-right">
              <span className="inline-flex items-center gap-1">
                {sortBtn("sharpe", "Sharpe")}
                <HelpTip text="Sharpe ratio — return earned per unit of risk (return above the risk-free rate ÷ standard deviation). Higher means better risk-adjusted return." />
              </span>
            </th>
            <th className="py-2 text-right">{sortBtn("value", "Value")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className="border-b border-hair">
              <td className="py-2">
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: colorMap.get(r.key) }}
                  />
                  <span>
                    {r.name}
                    {r.residualUnallocatedPct > 0.005
                      ? ` (${pct(r.residualUnallocatedPct)} unallocated)`
                      : ""}
                  </span>
                </span>
              </td>
              <td className="py-2">{labelForType(r.type)}</td>
              <td className="py-2 text-right">{pct(r.stats.geometricReturn)}</td>
              <td className="py-2 text-right">{pct(r.stats.arithmeticMean)}</td>
              <td className="py-2 text-right">{pct(r.stats.stdDev)}</td>
              <td className="py-2 text-right">
                {r.stats.sharpe === null ? "—" : r.stats.sharpe.toFixed(2)}
              </td>
              <td className="py-2 text-right">{r.value === null ? "—" : money(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
