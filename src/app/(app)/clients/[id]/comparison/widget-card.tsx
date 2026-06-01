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
  onDuplicate: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  dragAttributes?: Record<string, unknown>;
  dragListeners?: Record<string, unknown>;
}

function lookup(scenarios: ScenarioLookup[], id: string): string {
  if (id === "base") return "Base";
  return scenarios.find((s) => s.id === id)?.name ?? id;
}

export function WidgetCard({
  widget,
  widthBadge,
  scenarios,
  onEdit,
  onRemove,
  onDuplicate,
  onMoveLeft,
  onMoveRight,
  canMoveLeft,
  canMoveRight,
  dragAttributes,
  dragListeners,
}: Props) {
  const def = COMPARISON_WIDGETS[widget.kind];
  const showChips = def.scenarios !== "none";
  const needsAnotherPlan =
    def.scenarios === "many-only" && widget.planIds.length < 2;

  return (
    <div
      data-widget-card={widget.id}
      className="flex h-full flex-col gap-2 rounded-lg border border-hair bg-card p-3 text-sm text-ink-2"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          data-drag-handle="widget"
          aria-label="Drag widget"
          className="cursor-grab text-ink-3 hover:text-ink"
          {...(dragAttributes ?? {})}
          {...(dragListeners ?? {})}
        >
          ⋮⋮
        </button>
        <span className="flex-1 truncate font-medium">{def.title}</span>
        <span className="rounded border border-hair px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-3">
          {widthBadge}
        </span>
        <button
          type="button"
          aria-label="Edit widget"
          onClick={onEdit}
          className="rounded px-1 text-ink-3 hover:bg-card-hover hover:text-ink"
        >
          ✎
        </button>
        <button
          type="button"
          aria-label="Duplicate widget"
          onClick={onDuplicate}
          className="rounded px-1 text-ink-3 hover:bg-card-hover hover:text-ink"
        >
          ⎘
        </button>
        <button
          type="button"
          aria-label="Remove widget"
          onClick={onRemove}
          className="rounded px-1 text-ink-3 hover:bg-card-hover hover:text-ink"
        >
          🗑
        </button>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Move widget left"
          onClick={onMoveLeft}
          disabled={!canMoveLeft}
          className="rounded px-1 text-ink-3 hover:bg-card-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          ←
        </button>
        <button
          type="button"
          aria-label="Move widget right"
          onClick={onMoveRight}
          disabled={!canMoveRight}
          className="rounded px-1 text-ink-3 hover:bg-card-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
        >
          →
        </button>
      </div>

      {showChips && (
        <div className="flex flex-wrap gap-1">
          {widget.planIds.map((pid) => (
            <span
              key={pid}
              data-testid="plan-chip"
              className="rounded-full border border-hair px-2 py-0.5 text-[11px] text-ink-2"
            >
              {lookup(scenarios, pid)}
            </span>
          ))}
        </div>
      )}

      {needsAnotherPlan && (
        <p className="text-[11px] italic text-warn">
          This widget needs a second scenario before it can render.
        </p>
      )}
    </div>
  );
}
