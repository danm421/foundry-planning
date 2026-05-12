"use client";

import { useMemo, useState } from "react";
import type { ComparisonWidgetKindV4 } from "@/lib/comparison/layout-schema";
import { WIDGET_KINDS_V4 } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import type { UseLayoutApi } from "./use-layout";

interface Props {
  api: UseLayoutApi;
  primaryScenarioId: string;
}

const CATEGORY_ORDER: Array<{ key: string; title: string }> = [
  { key: "kpis", title: "KPIs" },
  { key: "cashflow", title: "Cash Flow" },
  { key: "investments", title: "Investments" },
  { key: "monte-carlo", title: "Monte Carlo" },
  { key: "retirement-income", title: "Retirement Income" },
  { key: "tax", title: "Tax" },
  { key: "estate", title: "Estate" },
  { key: "text", title: "Text" },
];

const HIDE_FROM_AVAILABLE: ReadonlySet<string> = new Set(["kpi-strip"]);

export function WidgetPicker({ api, primaryScenarioId }: Props) {
  const [activeTab, setActiveTab] = useState<string>(CATEGORY_ORDER[0].key);
  const [query, setQuery] = useState("");

  const byCategory = useMemo(() => {
    const m = new Map<string, ComparisonWidgetKindV4[]>();
    for (const kind of WIDGET_KINDS_V4) {
      if (HIDE_FROM_AVAILABLE.has(kind)) continue;
      const def = COMPARISON_WIDGETS[kind];
      if (!def) continue;
      const list = m.get(def.category) ?? [];
      list.push(kind);
      m.set(def.category, list);
    }
    return m;
  }, []);

  const isSearching = query.trim().length > 0;
  const entries: Array<{ kind: ComparisonWidgetKindV4; category: string }> = useMemo(() => {
    if (isSearching) {
      const q = query.trim().toLowerCase();
      return WIDGET_KINDS_V4
        .filter((k) => !HIDE_FROM_AVAILABLE.has(k))
        .filter((k) => COMPARISON_WIDGETS[k]?.title.toLowerCase().includes(q))
        .map((k) => ({ kind: k, category: COMPARISON_WIDGETS[k].category }));
    }
    return (byCategory.get(activeTab) ?? []).map((k) => ({ kind: k, category: activeTab }));
  }, [activeTab, query, isSearching, byCategory]);

  const handleAdd = (kind: ComparisonWidgetKindV4) => {
    const { rowId, placeholderCellId } = api.addRow();
    api.addCell(rowId, kind);
    api.removeCell(rowId, placeholderCellId);
  };

  const handleReset = () => {
    if (window.confirm("Replace the current layout with the default? This cannot be undone.")) {
      api.reset(primaryScenarioId);
    }
  };

  return (
    <aside
      aria-label="Widget picker"
      className="flex w-[280px] flex-col border-l border-slate-800 bg-slate-950"
    >
      <div className="border-b border-slate-800 p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search widgets…"
          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 placeholder:text-slate-500"
        />
      </div>

      <div
        role="tablist"
        aria-disabled={isSearching}
        className={`flex shrink-0 gap-1 overflow-x-auto border-b border-slate-800 px-2 py-1 ${isSearching ? "opacity-40" : ""}`}
      >
        {CATEGORY_ORDER.map(({ key, title }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={!isSearching && activeTab === key}
            onClick={() => setActiveTab(key)}
            className={`shrink-0 rounded px-2 py-0.5 text-[11px] uppercase tracking-wider ${
              !isSearching && activeTab === key
                ? "bg-slate-800 text-slate-100"
                : "text-slate-400 hover:bg-slate-900"
            }`}
          >
            {title}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-slate-500">No widgets match.</div>
        ) : (
          entries.map(({ kind, category }) => {
            const def = COMPARISON_WIDGETS[kind];
            const badgeTitle = CATEGORY_ORDER.find((c) => c.key === category)?.title ?? category;
            return (
              <button
                key={kind}
                type="button"
                data-available-kind={kind}
                onClick={() => handleAdd(kind)}
                className="flex w-full items-center gap-2 border-b border-slate-800 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
              >
                <span className="flex-1 truncate">{def?.title}</span>
                {isSearching && (
                  <span className="rounded border border-slate-700 px-1 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
                    {badgeTitle}
                  </span>
                )}
              </button>
            );
          })
        )}
      </div>

      <footer className="border-t border-slate-800 px-3 py-2">
        <button
          type="button"
          onClick={handleReset}
          className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
        >
          Reset to default
        </button>
      </footer>
    </aside>
  );
}
