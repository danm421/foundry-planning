"use client";

import { useMemo, useState } from "react";
import { PortfolioAnalysisScatter } from "./portfolio-analysis-scatter";
import type { AnalysisRow, EntityType, UnplottableAccount } from "@/lib/investments/portfolio-analysis";

const SERIES: { type: EntityType; label: string }[] = [
  { type: "asset_class", label: "Asset Classes" },
  { type: "account", label: "Accounts" },
  { type: "category", label: "Account Categories" },
  { type: "custom_group", label: "Custom Groups" },
  { type: "model_portfolio", label: "Model Portfolios" },
];

// Default: categories + custom groups + model portfolios on; asset classes + accounts off.
const DEFAULT_ON: Set<EntityType> = new Set(["category", "custom_group", "model_portfolio"]);

const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
const money = (v: number) =>
  v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type SortKey = "name" | "arithmeticMean" | "geometricReturn" | "stdDev" | "sharpe" | "value";

export default function PortfolioAnalysisClient({
  analysisRows,
  unplottableAccounts,
}: {
  analysisRows: AnalysisRow[];
  unplottableAccounts: UnplottableAccount[];
}) {
  const [enabled, setEnabled] = useState<Set<EntityType>>(new Set(DEFAULT_ON));
  const [sortKey, setSortKey] = useState<SortKey>("stdDev");
  const [asc, setAsc] = useState(true);

  const visible = useMemo(
    () => analysisRows.filter((r) => enabled.has(r.type)),
    [analysisRows, enabled],
  );

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

  const toggle = (t: EntityType) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(t)) {
        next.delete(t);
      } else {
        next.add(t);
      }
      return next;
    });

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
      <div className="flex flex-wrap gap-3">
        {SERIES.map((s) => (
          <label key={s.type} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={enabled.has(s.type)} onChange={() => toggle(s.type)} />
            {s.label}
          </label>
        ))}
      </div>

      <div className="h-[480px]">
        <PortfolioAnalysisScatter rows={visible} />
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="py-2 text-left">{sortBtn("name", "Name")}</th>
            <th className="py-2 text-left">Type</th>
            <th className="py-2 text-right">{sortBtn("arithmeticMean", "Return")}</th>
            <th className="py-2 text-right">{sortBtn("geometricReturn", "Geometric")}</th>
            <th className="py-2 text-right">{sortBtn("stdDev", "Std Dev")}</th>
            <th className="py-2 text-right">{sortBtn("sharpe", "Sharpe")}</th>
            <th className="py-2 text-right">{sortBtn("value", "Value")}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.key} className="border-b border-gray-800">
              <td className="py-2">
                {r.name}
                {r.residualUnallocatedPct > 0.005
                  ? ` (${pct(r.residualUnallocatedPct)} unallocated)`
                  : ""}
              </td>
              <td className="py-2">{SERIES.find((s) => s.type === r.type)?.label}</td>
              <td className="py-2 text-right">{pct(r.stats.arithmeticMean)}</td>
              <td className="py-2 text-right">{pct(r.stats.geometricReturn)}</td>
              <td className="py-2 text-right">{pct(r.stats.stdDev)}</td>
              <td className="py-2 text-right">
                {r.stats.sharpe === null ? "—" : r.stats.sharpe.toFixed(2)}
              </td>
              <td className="py-2 text-right">{r.value === null ? "—" : money(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {unplottableAccounts.length > 0 && (
        <div className="text-sm text-gray-400">
          <p className="font-medium">Not plottable (no asset mix):</p>
          <ul className="list-disc pl-5">
            {unplottableAccounts.map((u) => (
              <li key={u.id}>
                {u.name} — {money(u.value)} ({u.reason})
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
