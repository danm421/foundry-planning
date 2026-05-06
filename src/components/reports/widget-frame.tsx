// src/components/reports/widget-frame.tsx
//
// Wrapper around a populated canvas slot. When the widget is selected,
// surfaces a thin chrome bar above the widget (kind/layout label +
// duplicate/delete buttons) and a pronounced ring + shadow-glow around
// the widget body. Replaces the inline `ring-2 ring-accent` wrapper that
// previously lived in `CanvasSlot` (Task 15).

"use client";
import type { ReactNode } from "react";
import { getWidget } from "@/lib/reports/widget-registry";
import type { Widget, RowSize } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";

export function WidgetFrame({
  widget,
  rowLayout,
  selected,
  onSelect,
  dispatch,
  children,
}: {
  widget: Widget;
  rowLayout: RowSize;
  selected: boolean;
  onSelect: () => void;
  dispatch: React.Dispatch<Action>;
  children: ReactNode;
}) {
  const entry = getWidget(widget.kind);
  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
      className={`relative rounded-sm transition ${
        selected
          ? "ring-2 ring-accent shadow-[0_0_0_4px_rgba(245,158,11,0.15)]"
          : ""
      }`}
    >
      {selected && (
        <div className="absolute -top-4 left-0 right-0 h-4 flex items-center gap-2 px-1 text-[10px] font-mono">
          <span className="text-ink-3">
            {entry.kind} · {rowLayout}
          </span>
          <span className="ml-auto flex gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                dispatch({
                  type: "DUPLICATE_WIDGET",
                  widgetId: widget.id,
                  newId: crypto.randomUUID(),
                });
              }}
              aria-label="Duplicate widget"
              className="text-ink-3 hover:text-ink"
            >
              ⌘D
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                dispatch({ type: "DELETE_WIDGET", widgetId: widget.id });
              }}
              aria-label="Delete widget"
              className="text-crit hover:opacity-80"
            >
              ×
            </button>
          </span>
        </div>
      )}
      {children}
    </div>
  );
}
