"use client";

import { useMemo, useState } from "react";
import type { WidgetInstance, YearRange, ComparisonWidgetKindV4 } from "@/lib/comparison/layout-schema";
import { WIDGET_KINDS_V4 } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import type { ComparisonWidgetCategory } from "@/lib/comparison/widgets/types";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { ScenarioChipPicker } from "./scenario-chip-picker";
import { PerWidgetYearRange } from "./per-widget-year-range";

const HIDE_FROM_PICKER: ReadonlySet<string> = new Set(["kpi-strip"]);

const CATEGORY_ORDER: readonly ComparisonWidgetCategory[] = [
  "kpis",
  "cashflow",
  "investments",
  "retirement-income",
  "tax",
  "monte-carlo",
  "estate",
  "text",
];

const CATEGORY_LABELS: Record<ComparisonWidgetCategory, string> = {
  kpis: "KPIs",
  cashflow: "Cash flow",
  investments: "Investments",
  "retirement-income": "Retirement",
  tax: "Tax",
  "monte-carlo": "Monte Carlo",
  estate: "Estate",
  text: "Other",
};

const VISIBLE_CATEGORIES: readonly ComparisonWidgetCategory[] = (() => {
  const used = new Set<ComparisonWidgetCategory>();
  for (const k of WIDGET_KINDS_V4) {
    if (HIDE_FROM_PICKER.has(k)) continue;
    used.add(COMPARISON_WIDGETS[k].category);
  }
  return CATEGORY_ORDER.filter((c) => used.has(c));
})();

function seedPlanIds(
  kind: ComparisonWidgetKindV4,
  primary: string,
  scenarios: { id: string }[],
): string[] {
  const def = COMPARISON_WIDGETS[kind];
  switch (def.scenarios) {
    case "none": return [];
    case "one": return [primary];
    case "one-or-many": return [primary];
    case "many-only": {
      const other = scenarios.find((s) => s.id !== primary)?.id ?? primary;
      return [primary, other];
    }
  }
}

function validate(kind: ComparisonWidgetKindV4, planIds: string[]): string | null {
  const expectation = COMPARISON_WIDGETS[kind].scenarios;
  if (expectation === "none" && planIds.length !== 0) return "This widget does not use scenarios.";
  if (expectation === "one" && planIds.length !== 1) return "Pick exactly one scenario.";
  if (expectation === "one-or-many" && planIds.length < 1) return "Pick at least one scenario.";
  if (expectation === "many-only" && planIds.length < 2) return "Pick at least two scenarios.";
  return null;
}

interface CommonProps {
  scenarios: { id: string; name: string }[];
  availableYearRange: { min: number; max: number };
  clientRetirementYear?: number | null;
  /** Loaded preview plans. Empty until the preview API resolves. Used to
   *  compute the "Data" preset's year range. */
  plans?: ComparisonPlan[];
  primaryScenarioId: string;
  onSave: (widget: WidgetInstance) => void;
  onClose: () => void;
}

type Props =
  | (CommonProps & { mode: "create"; widget?: undefined })
  | (CommonProps & { mode: "edit"; widget: WidgetInstance });

export function WidgetConfigModal(props: Props) {
  const {
    mode,
    scenarios,
    availableYearRange,
    clientRetirementYear = null,
    plans = [],
    primaryScenarioId,
    onSave,
    onClose,
  } = props;

  const [kind, setKind] = useState<ComparisonWidgetKindV4 | null>(
    mode === "edit" ? props.widget.kind : null,
  );
  const [planIds, setPlanIds] = useState<string[]>(
    mode === "edit" ? props.widget.planIds : [],
  );
  const [yearRange, setYearRange] = useState<YearRange | undefined>(
    mode === "edit" ? props.widget.yearRange : undefined,
  );
  const [config, setConfig] = useState<unknown>(
    mode === "edit" ? props.widget.config : undefined,
  );
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<ComparisonWidgetCategory>(
    () => {
      if (mode === "edit") return COMPARISON_WIDGETS[props.widget.kind].category;
      return VISIBLE_CATEGORIES[0];
    },
  );

  const hasSearch = search.trim().length > 0;

  const groupedKinds: { category: ComparisonWidgetCategory; kinds: ComparisonWidgetKindV4[] }[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = WIDGET_KINDS_V4.filter((k) => !HIDE_FROM_PICKER.has(k));
    const matching = q
      ? all.filter((k) => COMPARISON_WIDGETS[k].title.toLowerCase().includes(q))
      : all.filter((k) => COMPARISON_WIDGETS[k].category === activeCategory);
    const byCategory = new Map<ComparisonWidgetCategory, ComparisonWidgetKindV4[]>();
    for (const k of matching) {
      const cat = COMPARISON_WIDGETS[k].category;
      const bucket = byCategory.get(cat);
      if (bucket) bucket.push(k);
      else byCategory.set(cat, [k]);
    }
    return CATEGORY_ORDER.flatMap((category) => {
      const kinds = byCategory.get(category);
      if (!kinds || kinds.length === 0) return [];
      kinds.sort((a, b) =>
        COMPARISON_WIDGETS[a].title.localeCompare(COMPARISON_WIDGETS[b].title),
      );
      return [{ category, kinds }];
    });
  }, [search, activeCategory]);

  const def = kind ? COMPARISON_WIDGETS[kind] : null;
  const validationError = kind ? validate(kind, planIds) : "Pick a widget.";
  const canSave = validationError === null && kind !== null;

  const dataYearRange = useMemo<[number, number] | null>(() => {
    if (!def?.hasDataInYear || plans.length === 0 || planIds.length === 0) {
      return null;
    }
    const selectedIds = new Set(planIds);
    const selected = plans.filter((p) => selectedIds.has(p.id));
    if (selected.length === 0) return null;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const plan of selected) {
      for (const year of plan.result.years) {
        if (!def.hasDataInYear(plan, year)) continue;
        if (year.year < lo) lo = year.year;
        if (year.year > hi) hi = year.year;
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    return [lo, hi];
  }, [def, plans, planIds]);

  const handlePickKind = (next: ComparisonWidgetKindV4) => {
    setKind(next);
    const seeded = seedPlanIds(next, primaryScenarioId, scenarios);
    setPlanIds(seeded);
    const seededConfig = COMPARISON_WIDGETS[next].defaultConfig;
    setConfig(seededConfig);
  };

  const handleSave = () => {
    if (!kind || !canSave) return;
    const widget: WidgetInstance = {
      id: mode === "edit" ? props.widget.id : globalThis.crypto.randomUUID(),
      kind,
      planIds,
    };
    if (yearRange) widget.yearRange = yearRange;
    if (config !== undefined) widget.config = config;
    onSave(widget);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "create" ? "Add widget" : "Edit widget"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-paper/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[640px] max-w-full flex-col gap-3 overflow-hidden rounded-[var(--radius)] border-2 border-ink-3 bg-card text-sm text-slate-200 shadow-2xl ring-1 ring-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-hair px-4 py-3">
          <h2 className="text-base font-semibold text-ink">
            {mode === "create" ? "Add widget" : `Edit: ${def?.title}`}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded px-2 py-1 text-ink-3 hover:bg-card-hover hover:text-ink"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pt-3">
          {mode === "create" && (
            <section className="mb-3">
              <div
                role="tablist"
                aria-label="Widget category"
                className="-mx-4 mb-2 flex flex-wrap gap-x-1 border-b border-hair px-4"
              >
                {VISIBLE_CATEGORIES.map((category) => {
                  const isActive = !hasSearch && category === activeCategory;
                  return (
                    <button
                      key={category}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => {
                        setActiveCategory(category);
                        setSearch("");
                      }}
                      className={`-mb-px border-b-2 px-2 py-1.5 text-xs ${
                        isActive
                          ? "border-accent text-accent-ink"
                          : "border-transparent text-ink-2 hover:text-ink"
                      }`}
                    >
                      {CATEGORY_LABELS[category]}
                    </button>
                  );
                })}
              </div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search all widgets…"
                className="mb-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-ink-3"
              />
              <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                {groupedKinds.length === 0 ? (
                  <p className="px-1 py-2 text-[11px] italic text-ink-3">
                    {hasSearch
                      ? `No widgets match “${search.trim()}”.`
                      : "No widgets in this category."}
                  </p>
                ) : (
                  groupedKinds.map(({ category, kinds }) => (
                    <div key={category}>
                      {hasSearch && (
                        <div className="mb-1 px-1 text-[10px] font-medium uppercase tracking-wider text-ink-3">
                          {CATEGORY_LABELS[category]}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1">
                        {kinds.map((k) => {
                          const selected = kind === k;
                          return (
                            <button
                              key={k}
                              type="button"
                              onClick={() => handlePickKind(k)}
                              aria-pressed={selected}
                              className={`rounded border px-2 py-1 text-left text-xs ${
                                selected
                                  ? "border-amber-400 bg-amber-400/10 text-amber-200"
                                  : "border-slate-700 hover:bg-slate-800"
                              }`}
                            >
                              {COMPARISON_WIDGETS[k].title}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          )}

          {def && def.scenarios !== "none" && (
            <section className="mb-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-3">Scenarios</div>
              <ScenarioChipPicker
                cardinality={def.scenarios}
                scenarios={scenarios}
                planIds={planIds}
                onChange={setPlanIds}
              />
            </section>
          )}

          {def && def.scenarios !== "none" && (
            <section className="mb-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-3">Year range</div>
              <PerWidgetYearRange
                min={availableYearRange.min}
                max={availableYearRange.max}
                yearRange={yearRange}
                onChange={setYearRange}
                clientRetirementYear={clientRetirementYear}
                dataYearRange={dataYearRange}
                dataPresetSupported={Boolean(def?.hasDataInYear)}
              />
            </section>
          )}

          {def?.renderConfig && (
            <section className="mb-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-3">Options</div>
              {def.renderConfig({ config, onChange: setConfig })}
            </section>
          )}

          {validationError && kind && (
            <p className="text-[11px] italic text-amber-300">{validationError}</p>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-hair px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 px-3 py-1 text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="rounded border border-amber-400 bg-amber-400/10 px-3 py-1 text-amber-200 disabled:opacity-40"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
