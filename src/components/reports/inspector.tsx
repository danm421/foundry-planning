// src/components/reports/inspector.tsx
//
// Right pane of the builder. Resolves the selected widget via the
// registry, renders its `Inspector` component, and dispatches
// UPDATE_WIDGET_PROPS on change. The "no selection" state is unchanged
// from Task 8 — it shows guidance text until a block is clicked or
// dragged from the library.

"use client";
import type { Page, Widget } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";
import { getWidget } from "@/lib/reports/widget-registry";

function findWidget(pages: Page[], id: string): Widget | null {
  for (const p of pages) for (const r of p.rows) for (const w of r.slots) if (w?.id === id) return w;
  return null;
}

export function Inspector({
  pages, selectedWidgetId, dispatch,
}: {
  pages: Page[];
  selectedWidgetId: string | null;
  dispatch: React.Dispatch<Action>;
}) {
  if (selectedWidgetId === null) {
    return (
      <aside className="w-[320px] border-l border-hair bg-card overflow-y-auto">
        <div className="p-4 text-[12px] font-mono text-ink-3 uppercase tracking-wider">Inspector</div>
        <div className="px-4 text-[13px] text-ink-3">No selection. Click a block to edit, or drag from the library.</div>
      </aside>
    );
  }
  const w = findWidget(pages, selectedWidgetId);
  if (!w) return null;
  const entry = getWidget(w.kind);
  const Inspector = entry.Inspector;
  return (
    <aside className="w-[320px] border-l border-hair bg-card overflow-y-auto">
      <div className="p-4 border-b border-hair">
        <div className="text-[12px] font-mono uppercase tracking-wider text-ink-3">{entry.kind} · {w.id.slice(0,6)}</div>
        <div className="text-[15px] text-ink mt-0.5">{entry.label}</div>
      </div>
      <Inspector
        props={w.props as never}
        onChange={(next) => dispatch({ type: "UPDATE_WIDGET_PROPS", widgetId: w.id, props: next })}
      />
    </aside>
  );
}
