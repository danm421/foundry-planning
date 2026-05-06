// src/components/reports/keyboard-shortcuts.tsx
//
// Global keydown listener for the report builder. Bails when the event
// originates inside an `<input>`, `<textarea>`, or contenteditable so the
// inspector/title editor keep their normal typing behavior.
//
// Shortcuts:
//   Escape           → clear selection
//   ⌘D / Ctrl+D      → duplicate selected widget
//   Delete/Backspace → delete selected widget
//   ⌘X / Ctrl+X      → cut: stash selected widget in clipboardRef + delete
//   ⌘V / Ctrl+V      → paste: append a new 1-up row to page 0 and place
//                       the stashed widget there with its props
//
// Cut/paste uses a mutable React ref (one slot, last-wins). The setTimeout
// for paste is the same wart as the dormant page-bottom drop branch in
// `builder.tsx#handleDragEnd` — pending an `ADD_ROW.rowId` reducer signature.

"use client";
import { useEffect } from "react";
import type { Action } from "@/lib/reports/reducer";
import type { Widget, Page } from "@/lib/reports/types";

export function KeyboardShortcuts({
  selectedWidgetId,
  setSelectedWidgetId,
  dispatch,
  pages,
  clipboardRef,
}: {
  selectedWidgetId: string | null;
  setSelectedWidgetId: (id: string | null) => void;
  dispatch: React.Dispatch<Action>;
  pages: Page[];
  clipboardRef: { current: Widget | null };
}) {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (
        t.tagName === "INPUT" ||
        t.tagName === "TEXTAREA" ||
        t.isContentEditable
      )
        return;

      if (e.key === "Escape") setSelectedWidgetId(null);
      if (!selectedWidgetId) return;

      const findWidget = (): Widget | null => {
        for (const p of pages)
          for (const r of p.rows)
            for (const w of r.slots)
              if (w?.id === selectedWidgetId) return w;
        return null;
      };

      if ((e.metaKey || e.ctrlKey) && e.key === "d") {
        e.preventDefault();
        dispatch({
          type: "DUPLICATE_WIDGET",
          widgetId: selectedWidgetId,
          newId: crypto.randomUUID(),
        });
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        dispatch({ type: "DELETE_WIDGET", widgetId: selectedWidgetId });
        setSelectedWidgetId(null);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "x") {
        const w = findWidget();
        if (w) {
          clipboardRef.current = w;
          dispatch({ type: "DELETE_WIDGET", widgetId: selectedWidgetId });
          setSelectedWidgetId(null);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "v") {
        const w = clipboardRef.current;
        if (!w) return;
        const targetPage = pages[0];
        if (!targetPage) return;
        const newId = crypto.randomUUID();
        const newRowId = crypto.randomUUID();
        dispatch({ type: "ADD_ROW", pageId: targetPage.id, layout: "1-up" });
        // TODO(reducer ADD_ROW.rowId): the `pages` snapshot inside this
        // setTimeout is the closed-over render-time array — it does NOT see
        // the row added by the dispatch above. So `pages[0].rows[length-1].id`
        // is the SECOND-to-last row in the post-dispatch state, not the new
        // one. The right fix is to extend ADD_ROW with an optional `rowId`
        // so the keyboard handler can pre-allocate `newRowId` and pass it
        // to both ADD_ROW and ADD_WIDGET_TO_SLOT. Same wart sits dormant in
        // builder.tsx's page-bottom drop branch.
        setTimeout(() => {
          dispatch({
            type: "ADD_WIDGET_TO_SLOT",
            pageId: targetPage.id,
            rowId: pages[0].rows[pages[0].rows.length - 1].id,
            slotIndex: 0,
            kind: w.kind,
            widgetId: newId,
          });
          dispatch({
            type: "UPDATE_WIDGET_PROPS",
            widgetId: newId,
            props: w.props,
          });
          setSelectedWidgetId(newId);
        }, 0);
        void newRowId;
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedWidgetId, setSelectedWidgetId, dispatch, pages, clipboardRef]);
  return null;
}
