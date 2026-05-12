"use client";

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CellSpan, CellV5 } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";

export interface ScenarioLookup {
  id: string;
  name: string;
}

interface Props {
  cell: CellV5;
  groupId: string;
  scenarios: ScenarioLookup[];
  onAddWidget: () => void;
  onEditWidget: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onAddRight: () => void;
  onAddDown: () => void;
  onChangeSpan: (span: CellSpan) => void;
}

const SPAN_TO_CLASS: Record<CellSpan, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  5: "col-span-5",
};

const ACTION_BTN =
  "rounded border border-slate-500 bg-slate-800 px-1.5 py-0.5 text-slate-100 shadow-sm hover:border-amber-400 hover:bg-slate-700 hover:text-amber-200 focus:outline-none focus:ring-1 focus:ring-amber-400";

function lookup(scenarios: ScenarioLookup[], id: string): string {
  if (id === "base") return "Base";
  return scenarios.find((s) => s.id === id)?.name ?? id;
}

const SPAN_VALUES: CellSpan[] = [1, 2, 3, 4, 5];

function SpanPicker({
  span,
  onChange,
}: {
  span: CellSpan;
  onChange: (next: CellSpan) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Cell width"
      className="inline-flex items-center gap-0.5 rounded border border-slate-600 bg-slate-800 p-0.5"
    >
      {SPAN_VALUES.map((n) => {
        const active = n === span;
        return (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`Width ${n} of 5`}
            title={`Width ${n}/5`}
            onClick={(e) => {
              e.stopPropagation();
              if (!active) onChange(n);
            }}
            className={
              active
                ? "rounded bg-amber-400 px-1.5 py-0.5 text-[10px] font-semibold text-slate-900"
                : "rounded px-1.5 py-0.5 text-[10px] text-slate-300 hover:bg-slate-700 hover:text-slate-100"
            }
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

export function CanvasCell({
  cell,
  groupId,
  scenarios,
  onAddWidget,
  onEditWidget,
  onRemove,
  onDuplicate,
  onAddRight,
  onAddDown,
  onChangeSpan,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cell.id,
    data: { type: "cell", groupId },
  });
  const [selected, setSelected] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onDocMouseDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (!root) return;
      if (e.target instanceof Node && !root.contains(e.target)) {
        setSelected(false);
      }
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [selected]);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const widget = cell.widget;
  const def = widget ? COMPARISON_WIDGETS[widget.kind] : null;

  const selectedRingPopulated = selected ? "border-amber-400 ring-1 ring-amber-400/40" : "border-slate-700";
  const selectedRingEmpty = selected ? "border-amber-400 ring-1 ring-amber-400/40" : "border-slate-700";

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        setNodeRef(node);
      }}
      style={style}
      data-canvas-cell={cell.id}
      data-canvas-group={groupId}
      data-span={cell.span}
      data-selected={selected || undefined}
      onMouseDown={() => setSelected(true)}
      className={`${SPAN_TO_CLASS[cell.span]} relative min-w-0`}
    >
      {widget && def ? (
        <div className={`flex h-full flex-col gap-2 rounded-lg border ${selectedRingPopulated} bg-slate-900 p-3 text-sm text-slate-200`}>
          <div className="flex items-start gap-2">
            <button
              type="button"
              aria-label="Drag widget"
              title="Drag to reorder"
              className="cursor-grab text-slate-400 hover:text-slate-200"
              {...attributes}
              {...listeners}
            >
              ⋮⋮
            </button>
            <span className="flex-1 truncate font-medium">{def.title}</span>
            <SpanPicker span={cell.span} onChange={onChangeSpan} />
            {selected && (
              <>
                <button type="button" aria-label="Edit widget" title="Edit" onClick={onEditWidget} className={ACTION_BTN}>✎</button>
                <button type="button" aria-label="Duplicate widget" title="Duplicate" onClick={onDuplicate} className={ACTION_BTN}>⎘</button>
                <button type="button" aria-label="Add right" title="Add right" onClick={onAddRight} className={ACTION_BTN}>→</button>
                <button type="button" aria-label="Add down" title="Add below" onClick={onAddDown} className={ACTION_BTN}>↓</button>
                <button type="button" aria-label="Remove widget" title="Remove" onClick={onRemove} className={ACTION_BTN}>🗑</button>
              </>
            )}
          </div>

          {def.scenarios !== "none" && (
            <div className="flex flex-wrap gap-1">
              {widget.planIds.map((pid) => (
                <span key={pid} data-testid="plan-chip" className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                  {lookup(scenarios, pid)}
                </span>
              ))}
            </div>
          )}

        </div>
      ) : (
        <div className={`flex h-full min-h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed ${selectedRingEmpty} p-3`}>
          <button
            type="button"
            aria-label="Add widget"
            title="Add widget"
            onClick={onAddWidget}
            className="rounded-full border border-slate-500 bg-slate-800 px-3 py-1 text-2xl text-slate-100 shadow-sm hover:border-amber-400 hover:bg-slate-700 hover:text-amber-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            +
          </button>
          <SpanPicker span={cell.span} onChange={onChangeSpan} />
          {selected && (
            <div className="flex items-center gap-1">
              <button type="button" aria-label="Add right" title="Add right" onClick={onAddRight} className={ACTION_BTN}>→</button>
              <button type="button" aria-label="Add down" title="Add below" onClick={onAddDown} className={ACTION_BTN}>↓</button>
              <button type="button" aria-label="Remove placeholder" title="Remove" onClick={onRemove} className={ACTION_BTN}>🗑</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
