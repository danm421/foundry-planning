"use client";

import { useMemo, useState } from "react";
import type { WidgetInstance, YearRange, ComparisonWidgetKindV4 } from "@/lib/comparison/layout-schema";
import { WIDGET_KINDS_V4 } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import { ScenarioChipPicker } from "./scenario-chip-picker";
import { PerWidgetYearRange } from "./per-widget-year-range";

const HIDE_FROM_PICKER: ReadonlySet<string> = new Set(["kpi-strip"]);

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
  primaryScenarioId: string;
  onSave: (widget: WidgetInstance) => void;
  onClose: () => void;
}

type Props =
  | (CommonProps & { mode: "create"; widget?: undefined })
  | (CommonProps & { mode: "edit"; widget: WidgetInstance });

export function WidgetConfigModal(props: Props) {
  const { mode, scenarios, availableYearRange, primaryScenarioId, onSave, onClose } = props;

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

  const filteredKinds: ComparisonWidgetKindV4[] = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = WIDGET_KINDS_V4.filter((k) => !HIDE_FROM_PICKER.has(k));
    if (!q) return all;
    return all.filter((k) => COMPARISON_WIDGETS[k].title.toLowerCase().includes(q));
  }, [search]);

  const def = kind ? COMPARISON_WIDGETS[kind] : null;
  const validationError = kind ? validate(kind, planIds) : "Pick a widget.";
  const canSave = validationError === null && kind !== null;

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
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Widget</div>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="mb-2 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-200 placeholder:text-slate-500"
              />
              <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto">
                {filteredKinds.map((k) => {
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
            </section>
          )}

          {def && def.scenarios !== "none" && (
            <section className="mb-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Scenarios</div>
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
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Year range</div>
              <PerWidgetYearRange
                min={availableYearRange.min}
                max={availableYearRange.max}
                yearRange={yearRange}
                onChange={setYearRange}
              />
            </section>
          )}

          {def?.renderConfig && (
            <section className="mb-3">
              <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">Options</div>
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
