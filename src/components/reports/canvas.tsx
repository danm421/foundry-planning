// src/components/reports/canvas.tsx
//
// Center pane of the builder. Renders pages → rows → slots, delegating
// each row's chrome (drag handle, layout pills, +above/+below, delete)
// and slot rendering to `CanvasRow` (which owns the now-private
// `CanvasSlot`). Row gaps between rows are `RowGap` droppables that
// accept row-source drags for same-page reordering. Selection is
// driven by click handlers that stop propagation so the bare-canvas
// click can clear the selection.

"use client";
import type { Page } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";
import { CanvasRow, RowGap } from "./canvas-row";

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
          <div key={p.id} className="bg-card border border-hair rounded-sm p-12 space-y-2">
            {p.rows.length === 0 ? (
              // Empty pages intentionally render no RowGap droppables — same-page-only
              // row reorder (handleDragEnd in builder.tsx) means there is nothing
              // useful to drop here. Add the first row via this button instead.
              <button
                onClick={(e) => { e.stopPropagation(); dispatch({ type: "ADD_ROW", pageId: p.id, layout: "2-up" }); }}
                className="text-[12px] font-mono text-ink-3 hover:text-ink"
              >+ Add first row</button>
            ) : (
              <>
                <RowGap pageId={p.id} index={0} />
                {p.rows.map((row, ri) => (
                  <div key={row.id}>
                    <CanvasRow
                      row={row}
                      page={p}
                      rowIndex={ri}
                      dispatch={dispatch}
                      selectedWidgetId={selectedWidgetId}
                      onSelectWidget={onSelectWidget}
                    />
                    <RowGap pageId={p.id} index={ri + 1} />
                  </div>
                ))}
              </>
            )}
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
