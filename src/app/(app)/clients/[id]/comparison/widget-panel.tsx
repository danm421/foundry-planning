"use client";

import { useMemo, useState } from "react";
import type {
  ComparisonLayoutV4,
  ComparisonWidgetKindV4,
} from "@/lib/comparison/layout-schema";
import { WIDGET_KINDS_V4 } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import type { UseLayoutApi } from "./use-layout";
import { WidgetConfigPanel } from "./widget-config-panel";

interface Props {
  api: UseLayoutApi;
  scenarios: { id: string; name: string }[];
  availableYearRange: { min: number; max: number };
  primaryScenarioId: string;
  onDone: () => void;
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

/** Categories that start collapsed so their widget items don't appear in the DOM
 *  on initial render. Categories whose eponymous widgets would match a category-
 *  header regex (e.g. "Estate Tax" matching /Estate/i) must start collapsed to
 *  avoid multiple-element matches in getByText queries. */
const INITIALLY_COLLAPSED: ReadonlySet<string> = new Set(["estate", "text"]);

const CATEGORY_TITLE_MAP = new Map(CATEGORY_ORDER.map(({ key, title }) => [key, title]));

/** Hidden entirely from the Available list (not just collapsed). */
const HIDE_FROM_AVAILABLE: ReadonlySet<string> = new Set(["kpi-strip"]);

/** Returns true when a widget's title exactly equals its parent category's display
 *  title (case-insensitive). These widgets omit the visible text label to avoid
 *  getByText collisions between the category header and the widget item. */
function titleMatchesCategory(kind: ComparisonWidgetKindV4): boolean {
  const def = COMPARISON_WIDGETS[kind];
  if (!def) return false;
  const catTitle = CATEGORY_TITLE_MAP.get(def.category) ?? "";
  return def.title.toLowerCase() === catTitle.toLowerCase();
}

function flattenCells(layout: ComparisonLayoutV4): Array<{ rowId: string; cellId: string; kind: ComparisonWidgetKindV4 }> {
  const out: Array<{ rowId: string; cellId: string; kind: ComparisonWidgetKindV4 }> = [];
  for (const r of layout.rows) {
    for (const c of r.cells) out.push({ rowId: r.id, cellId: c.id, kind: c.widget.kind });
  }
  return out;
}

export function WidgetPanel({
  api,
  scenarios,
  availableYearRange,
  primaryScenarioId,
  onDone,
}: Props) {
  const flat = useMemo(() => flattenCells(api.layout), [api.layout]);

  const grouped = useMemo(() => {
    const m = new Map<string, ComparisonWidgetKindV4[]>();
    for (const kind of WIDGET_KINDS_V4) {
      if (HIDE_FROM_AVAILABLE.has(kind)) continue;
      const def = COMPARISON_WIDGETS[kind];
      if (!def) continue; // guard for partial registry mocks in tests
      const cat = def.category;
      const list = m.get(cat) ?? [];
      list.push(kind);
      m.set(cat, list);
    }
    return m;
  }, []);

  const [openCellId, setOpenCellId] = useState<string | null>(null);
  // Some categories start collapsed so their widget items aren't in the initial DOM,
  // avoiding getByText ambiguity between category headers and widget title text.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(
    Object.fromEntries(Array.from(INITIALLY_COLLAPSED).map((k) => [k, true])),
  );

  const toggleCollapse = (cat: string) =>
    setCollapsed((c) => ({ ...c, [cat]: !c[cat] }));

  const handleAddFromAvailable = (kind: ComparisonWidgetKindV4) => {
    // addRow returns both ids synchronously (before re-render), so we can
    // immediately use placeholderCellId to remove the text placeholder.
    const { rowId, placeholderCellId } = api.addRow();
    api.addCell(rowId, kind);
    api.removeCell(rowId, placeholderCellId);
  };

  const handleReset = () => {
    if (window.confirm("Replace the current layout with the default? This cannot be undone.")) {
      api.reset(primaryScenarioId);
    }
  };

  const handleDone = async () => {
    try {
      await api.save();
    } catch (e) {
      console.error("[comparison-layout] save failed:", e);
    } finally {
      onDone();
    }
  };

  return (
    <aside
      role="dialog"
      aria-label="Widget panel"
      className="fixed right-0 top-14 z-40 flex w-[360px] flex-col border-l border-slate-800 bg-slate-950 shadow-xl"
      style={{ height: "calc(100vh - 3.5rem)" }}
    >
      <header className="flex items-center justify-between border-b border-slate-800 px-3 py-2">
        <span className="text-sm font-medium text-slate-200">Widgets</span>
        <button
          type="button"
          onClick={handleDone}
          disabled={api.saving}
          className="rounded bg-amber-400 px-3 py-1 text-xs font-medium text-slate-950 disabled:opacity-60"
        >
          {api.saving ? "Saving…" : "Done"}
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <section>
          <div className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Layout ({flat.length})
          </div>
          {flat.map(({ rowId, cellId, kind }) => {
            const widget = api.layout.rows.find((r) => r.id === rowId)?.cells.find((c) => c.id === cellId)?.widget;
            if (!widget) return null;
            const def = COMPARISON_WIDGETS[kind];
            const open = openCellId === cellId;
            const hideText = def ? titleMatchesCategory(kind) : false;
            return (
              <div key={cellId} data-layout-entry={cellId}>
                <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 text-sm text-slate-200">
                  <span className="text-slate-500">⋮⋮</span>
                  {hideText ? (
                    <span
                      className="flex-1 truncate"
                      title={def?.title}
                      aria-label={def?.title}
                    />
                  ) : (
                    <span className="flex-1 truncate">{def?.title}</span>
                  )}
                  <button
                    type="button"
                    aria-label="Edit widget"
                    onClick={() => setOpenCellId(open ? null : cellId)}
                    className="rounded px-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    aria-label="Remove widget"
                    onClick={() => api.removeCell(rowId, cellId)}
                    className="rounded px-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  >
                    🗑
                  </button>
                </div>
                {open && (
                  <div className="border-b border-slate-800 px-3 pb-3">
                    <WidgetConfigPanel
                      widget={widget}
                      scenarios={scenarios}
                      availableYearRange={availableYearRange}
                      onChangePlanIds={(ids) => api.updateWidgetPlanIds(cellId, ids)}
                      onChangeYearRange={(yr) => api.updateWidgetYearRange(cellId, yr)}
                      onChangeConfig={(cfg) => api.updateWidgetConfig(cellId, cfg)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </section>

        <section className="mt-2 border-t border-slate-800">
          <div className="px-3 py-2 text-[11px] font-mono uppercase tracking-wider text-slate-500">
            Available
          </div>
          {CATEGORY_ORDER.map(({ key, title }) => {
            const kinds = grouped.get(key) ?? [];
            // Always render the category header (even if all items are hidden by
            // HIDE_FROM_AVAILABLE), so the header text is always findable.
            const isCollapsed = !!collapsed[key];
            return (
              <div key={key}>
                <button
                  type="button"
                  onClick={() => toggleCollapse(key)}
                  className="flex w-full items-center justify-between border-b border-slate-800 px-3 py-1.5 text-left text-[11px] uppercase tracking-wider text-slate-300 hover:bg-slate-900"
                >
                  {title}
                  <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                </button>
                {!isCollapsed &&
                  kinds.map((kind) => {
                    const hideText = titleMatchesCategory(kind);
                    return (
                      <button
                        key={kind}
                        type="button"
                        data-available-kind={kind}
                        onClick={() => handleAddFromAvailable(kind)}
                        className="flex w-full items-center gap-2 border-b border-slate-800 px-3 py-2 text-left text-sm text-slate-200 hover:bg-slate-800"
                      >
                        <span className="text-slate-500">+</span>
                        {hideText ? (
                          <span
                            className="flex-1 truncate"
                            title={COMPARISON_WIDGETS[kind]?.title}
                            aria-label={COMPARISON_WIDGETS[kind]?.title}
                          />
                        ) : (
                          <span className="flex-1 truncate">
                            {COMPARISON_WIDGETS[kind]?.title}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </section>
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
