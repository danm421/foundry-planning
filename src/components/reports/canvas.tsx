// src/components/reports/canvas.tsx
//
// Center pane of the builder. Renders pages → rows → slots, delegating
// each row's chrome (drag handle, layout pills, +above/+below, delete)
// and slot rendering to `CanvasRow` (which owns the now-private
// `CanvasSlot`). Row gaps between rows are `RowGap` droppables that
// accept row-source drags for same-page reordering. Selection is
// driven by click handlers that stop propagation so the bare-canvas
// click can clear the selection.
//
// Task 17 layered three composition affordances on top:
//   - sticky toolbar with the edit/preview toggle and a page count;
//   - `PageLabelStrip` above each page (rotate / dup / delete);
//   - `PageDivider` before the first page, between pages, and after
//     the last page (replaces the old `+ portrait page` button).
// `previewMode` is local Canvas state — not lifted to Builder. The
// deselect-on-click handler is on the inner page-list wrapper so that
// clicking the toolbar does NOT clear the widget selection.

"use client";
import { Fragment, useState } from "react";
import type { Page } from "@/lib/reports/types";
import type { Action } from "@/lib/reports/reducer";
import { CanvasRow, RowGap } from "./canvas-row";
import { PageDivider } from "./page-divider";
import { PageLabelStrip } from "./page-label-strip";
import { PreviewToggle } from "./preview-toggle";
import type { ComparisonBindingDisplay } from "./builder";

export function Canvas({
  pages, dispatch, selectedWidgetId, onSelectWidget, comparisonBinding,
}: {
  pages: Page[];
  dispatch: React.Dispatch<Action>;
  selectedWidgetId: string | null;
  onSelectWidget: (id: string | null) => void;
  comparisonBinding?: ComparisonBindingDisplay | null;
}) {
  const [previewMode, setPreviewMode] = useState<"edit" | "preview">("edit");

  return (
    <main className="flex-1 overflow-y-auto bg-paper">
      {comparisonBinding && (
        <div className="border-b-2 border-accent bg-accent/5 px-4 py-2 flex items-center gap-3">
          <span className="text-[11px] font-mono text-ink-2 uppercase tracking-wider">
            Comparing
          </span>
          <span className="text-xs font-mono text-ink-2">
            {comparisonBinding.currentScenarioName}
            <span className="px-2 text-accent">→</span>
            {comparisonBinding.proposedScenarioName}
          </span>
        </div>
      )}
      <div className="sticky top-0 bg-paper border-b border-hair px-4 py-2 flex items-center gap-3 z-10">
        <PreviewToggle value={previewMode} onChange={setPreviewMode} />
        <div className="text-[11px] font-mono text-ink-3 ml-auto">{pages.length} {pages.length === 1 ? "page" : "pages"}</div>
      </div>
      <div className="px-8 py-6" onClick={() => onSelectWidget(null)}>
        <div className="max-w-[8.5in] mx-auto space-y-6">
          {pages.length === 0 && (
            <div className="border border-dashed border-hair rounded-sm p-12 text-center text-[13px] font-mono text-ink-3">
              No pages yet. Add a page below to get started.
            </div>
          )}
          <PageDivider dispatch={dispatch} />
          {pages.map((p, i) => (
            <Fragment key={p.id}>
              <PageLabelStrip page={p} index={i} dispatch={dispatch} />
              <div className={
                p.rows.length === 0
                  ? "bg-card/50 border border-dashed border-hair rounded-sm p-12 space-y-2"
                  : "bg-card border border-hair rounded-sm p-12 space-y-2"
              }>
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
                          previewMode={previewMode}
                        />
                        <RowGap pageId={p.id} index={ri + 1} />
                      </div>
                    ))}
                  </>
                )}
              </div>
              <PageDivider afterPageId={p.id} dispatch={dispatch} />
            </Fragment>
          ))}
        </div>
      </div>
    </main>
  );
}
