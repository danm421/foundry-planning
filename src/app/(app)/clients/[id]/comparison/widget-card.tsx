"use client";

import type { WidgetInstance } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";

export interface ScenarioLookup {
  id: string;
  name: string;
}

interface Props {
  widget: WidgetInstance;
  widthBadge: string;
  scenarios: ScenarioLookup[];
  onEdit: () => void;
  onRemove: () => void;
}

function lookup(scenarios: ScenarioLookup[], id: string): string {
  if (id === "base") return "Base";
  return scenarios.find((s) => s.id === id)?.name ?? id;
}

export function WidgetCard({ widget, widthBadge, scenarios, onEdit, onRemove }: Props) {
  const def = COMPARISON_WIDGETS[widget.kind];
  const showChips = def.scenarios !== "none";
  const needsAnotherPlan =
    def.scenarios === "many-only" && widget.planIds.length < 2;

  return (
    <div
      data-widget-card={widget.id}
      className="flex h-full flex-col gap-2 rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-slate-200"
    >
      <div className="flex items-start gap-2">
        <span className="text-slate-400" aria-hidden="true">⋮⋮</span>
        <span className="flex-1 truncate font-medium">{def.title}</span>
        <span className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-slate-400">
          {widthBadge}
        </span>
        <button
          type="button"
          aria-label="Edit widget"
          onClick={onEdit}
          className="rounded px-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          ✎
        </button>
        <button
          type="button"
          aria-label="Remove widget"
          onClick={onRemove}
          className="rounded px-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          🗑
        </button>
      </div>

      {showChips && (
        <div className="flex flex-wrap gap-1">
          {widget.planIds.map((pid) => (
            <span
              key={pid}
              data-testid="plan-chip"
              className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300"
            >
              {lookup(scenarios, pid)}
            </span>
          ))}
        </div>
      )}

      {needsAnotherPlan && (
        <p className="text-[11px] italic text-amber-300">
          This widget needs a second scenario before it can render.
        </p>
      )}
    </div>
  );
}
