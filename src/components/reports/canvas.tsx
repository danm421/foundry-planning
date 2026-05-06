// src/components/reports/canvas.tsx
//
// Center pane of the builder. Renders pages → rows → slots, resolving
// each widget via the registry. `data` is null for now; Task 13/14 wires
// per-widget fetchers and feeds real values through. Selection is driven
// by click handlers that stop propagation so the bare-canvas click can
// clear the selection.

"use client";
import type { Page } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";
import { getWidget } from "@/lib/reports/widget-registry";

export function Canvas({
  pages, dispatch, selectedWidgetId, onSelectWidget,
}: {
  pages: Page[];
  dispatch: React.Dispatch<Action>;
  selectedWidgetId: string | null;
  onSelectWidget: (id: string | null) => void;
}) {
  return (
    <main className="flex-1 overflow-y-auto bg-paper px-8 py-6" onClick={() => onSelectWidget(null)}>
      <div className="max-w-[8.5in] mx-auto space-y-6">
        {pages.map((p) => (
          <div key={p.id} className="bg-card border border-hair rounded-sm p-12 space-y-4">
            {p.rows.map((r) => (
              <div key={r.id} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${r.slots.length}, minmax(0, 1fr))` }}>
                {r.slots.map((w, i) => w === null ? (
                  <div key={i} className="border border-dashed border-hair rounded-sm h-24 text-ink-3 text-[11px] flex items-center justify-center">empty slot</div>
                ) : (
                  <div key={w.id}
                       onClick={(e) => { e.stopPropagation(); onSelectWidget(w.id); }}
                       className={selectedWidgetId === w.id ? "ring-2 ring-accent rounded-sm" : ""}>
                    {(() => {
                      const entry = getWidget(w.kind);
                      const Render = entry.Render;
                      // data is null for now — fetch wired in Task 13/14
                      return <Render props={w.props as never} data={null} mode="screen" widgetId={w.id} />;
                    })()}
                  </div>
                ))}
              </div>
            ))}
            <button
              onClick={(e) => { e.stopPropagation(); dispatch({ type: "ADD_ROW", pageId: p.id, layout: "2-up" }); }}
              className="text-[12px] font-mono text-ink-3 hover:text-ink"
            >+ Add 2-up row</button>
          </div>
        ))}
        <button
          onClick={(e) => { e.stopPropagation(); dispatch({ type: "ADD_PAGE", orientation: "portrait" }); }}
          className="block mx-auto text-[12px] font-mono text-ink-3 hover:text-ink"
        >+ portrait page</button>
      </div>
    </main>
  );
}
