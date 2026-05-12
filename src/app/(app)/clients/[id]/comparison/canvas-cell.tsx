"use client";

import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CellSpan, CellV5, WidgetInstance } from "@/lib/comparison/layout-schema";
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
  onSetWidget?: (widget: WidgetInstance) => void;
}

const SPAN_TO_CLASS: Record<CellSpan, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  5: "col-span-5",
};

const GRID_GAP_PX = 8; // tailwind gap-2 = 0.5rem

const ACTION_BTN =
  "rounded border border-slate-500 bg-slate-800 px-1.5 py-1 text-slate-100 shadow-sm hover:border-amber-400 hover:bg-slate-700 hover:text-amber-200 focus:outline-none focus:ring-1 focus:ring-amber-400";

function lookup(scenarios: ScenarioLookup[], id: string): string {
  if (id === "base") return "Base";
  return scenarios.find((s) => s.id === id)?.name ?? id;
}

function clampSpan(n: number): CellSpan {
  if (n < 1) return 1;
  if (n > 5) return 5;
  return n as CellSpan;
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
  onSetWidget,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cell.id,
    data: { type: "cell", groupId },
  });
  const [selected, setSelected] = useState(false);
  const [resizing, setResizing] = useState(false);
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

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const grid = rootRef.current?.parentElement;
    if (!grid) return;
    const colStep = (grid.clientWidth + GRID_GAP_PX) / 5;
    const startX = e.clientX;
    const startSpan = cell.span;
    let lastSpan: CellSpan = startSpan;
    setResizing(true);

    const onMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const next = clampSpan(startSpan + Math.round(dx / colStep));
      if (next !== lastSpan) {
        lastSpan = next;
        onChangeSpan(next);
      }
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setResizing(false);
    };
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const widget = cell.widget;
  const def = widget ? COMPARISON_WIDGETS[widget.kind] : null;

  const selectedRingPopulated = selected ? "border-amber-400 ring-1 ring-amber-400/40" : "border-ink-3";
  const selectedRingEmpty = selected ? "border-amber-400 ring-1 ring-amber-400/40" : "border-ink-3";

  const ResizeHandle = (
    <button
      type="button"
      aria-label="Resize cell width"
      title="Drag to resize"
      onMouseDown={handleResizeMouseDown}
      onClick={(e) => e.stopPropagation()}
      data-resize-handle
      className={`absolute right-0 top-1/2 z-20 h-12 w-1.5 -translate-y-1/2 cursor-ew-resize rounded-full transition-colors ${
        resizing ? "bg-amber-400" : "bg-slate-600 hover:bg-amber-400"
      }`}
    />
  );

  const SpanBadge = (
    <span className="rounded border border-slate-600 bg-slate-800 px-1 py-0.5 text-[10px] uppercase tracking-wider text-slate-300">
      {cell.span}/5
    </span>
  );

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
      className={`${SPAN_TO_CLASS[cell.span]} group/cell relative min-w-0`}
    >
      {selected && (
        <div
          data-testid="cell-toolbar"
          className="absolute bottom-full left-0 z-30 mb-1 flex w-max items-center gap-1 whitespace-nowrap rounded-lg border border-amber-400/60 bg-slate-900/95 p-1 shadow-xl backdrop-blur"
        >
          {widget ? (
            <>
              <button type="button" aria-label="Edit widget" title="Edit" onClick={onEditWidget} className={ACTION_BTN}>✎</button>
              <button type="button" aria-label="Duplicate widget" title="Duplicate" onClick={onDuplicate} className={ACTION_BTN}>⎘</button>
              <button type="button" aria-label="Add right" title="Add right" onClick={onAddRight} className={ACTION_BTN}>→</button>
              <button type="button" aria-label="Add down" title="Add below" onClick={onAddDown} className={ACTION_BTN}>↓</button>
              <button type="button" aria-label="Remove widget" title="Remove" onClick={onRemove} className={ACTION_BTN}>🗑</button>
            </>
          ) : (
            <>
              <button type="button" aria-label="Add right" title="Add right" onClick={onAddRight} className={ACTION_BTN}>→</button>
              <button type="button" aria-label="Add down" title="Add below" onClick={onAddDown} className={ACTION_BTN}>↓</button>
              <button type="button" aria-label="Remove placeholder" title="Remove" onClick={onRemove} className={ACTION_BTN}>🗑</button>
            </>
          )}
        </div>
      )}

      {widget && def ? (
        <div className={`flex h-full flex-col gap-2 rounded-lg border ${selectedRingPopulated} bg-slate-900 p-3 pr-4 text-sm text-slate-200`}>
          <div className="flex items-center gap-2">
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
            {SpanBadge}
          </div>

          {widget.kind === "text" && onSetWidget ? (
            <textarea
              aria-label="Text block content"
              value={
                typeof widget.config === "object" &&
                widget.config !== null &&
                "markdown" in widget.config
                  ? String((widget.config as { markdown?: string }).markdown ?? "")
                  : ""
              }
              onChange={(e) =>
                onSetWidget({ ...widget, config: { markdown: e.target.value } })
              }
              onMouseDown={(e) => e.stopPropagation()}
              placeholder="Type markdown… **bold**, *italic*, - list items"
              rows={4}
              className="w-full resize-y rounded border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs text-slate-100 placeholder:text-ink-3 focus:border-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
            />
          ) : (
            def.scenarios !== "none" && (
              <div className="flex flex-wrap gap-1">
                {widget.planIds.map((pid) => (
                  <span key={pid} data-testid="plan-chip" className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-300">
                    {lookup(scenarios, pid)}
                  </span>
                ))}
              </div>
            )
          )}
        </div>
      ) : (
        <div className={`flex h-full min-h-[120px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed ${selectedRingEmpty} p-3 pr-4`}>
          <button
            type="button"
            aria-label="Add widget"
            title="Add widget"
            onClick={onAddWidget}
            className="rounded-full border border-slate-500 bg-slate-800 px-3 py-1 text-2xl text-slate-100 shadow-sm hover:border-amber-400 hover:bg-slate-700 hover:text-amber-200 focus:outline-none focus:ring-1 focus:ring-amber-400"
          >
            +
          </button>
          {SpanBadge}
        </div>
      )}

      {ResizeHandle}
    </div>
  );
}
