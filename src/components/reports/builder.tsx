// src/components/reports/builder.tsx
//
// Client root of the report builder. Holds the reducer state, the
// currently-selected widget id, and renders the 3-pane layout.

"use client";
import "@/lib/reports/widgets";
import { useCallback, useReducer, useRef, useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { reducer, type ReportState } from "@/lib/reports/reducer";
import { ReportBuilderContext, type Household } from "./builder-context";
import { TopBar } from "./top-bar";
import { BlockLibrary } from "./block-library";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { useAutosave } from "./use-autosave";
import { canvasToPng } from "@/components/reports-pdf/chart-to-image";
import type { Page, Widget, WidgetKind } from "@/lib/reports/types";

export function Builder(props: {
  reportId: string;
  clientId: string;
  household: Household;
  householdName: string;
  initial: { title: string; pages: Page[] };
}) {
  const { reportId, clientId, household, householdName, initial } = props;
  const [state, dispatch] = useReducer(reducer, initial as ReportState);
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(null);
  const clipboardRef = useRef<Widget | null>(null);
  const status = useAutosave({
    clientId,
    reportId,
    state,
    initial: initial as ReportState,
  });

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    if (!e.over) return;
    const data = e.active.data.current as
      | { source: "library"; kind: WidgetKind }
      | { source: "row"; pageId: string; rowId: string; rowIndex: number }
      | undefined;
    const target = e.over.data.current as
      | { kind: "slot"; pageId: string; rowId: string; slotIndex: number }
      | { kind: "page-bottom"; pageId: string }
      | { kind: "row-drop"; pageId: string; index: number }
      | undefined;
    if (!data || !target) return;

    // Row → row-gap: same-page reorder (cross-page deferred to Cut/Paste).
    if (data.source === "row" && target.kind === "row-drop") {
      if (data.pageId !== target.pageId) return;
      // No-op when dropping into the same gap or directly adjacent.
      if (target.index === data.rowIndex || target.index === data.rowIndex + 1) return;
      // REORDER_ROWS expects `to` as the post-removal target index. dnd-kit
      // gives us a pre-removal "drop into gap N" index; if the source is
      // above the target gap, the index shifts down by 1 after the splice.
      const to = target.index > data.rowIndex ? target.index - 1 : target.index;
      dispatch({ type: "REORDER_ROWS", pageId: data.pageId, from: data.rowIndex, to });
      return;
    }

    // Library → slot/page-bottom: place a new widget.
    if (data.source !== "library") return;
    const newId = crypto.randomUUID();
    if (target.kind === "slot") {
      dispatch({ type: "ADD_WIDGET_TO_SLOT", pageId: target.pageId, rowId: target.rowId,
                 slotIndex: target.slotIndex, kind: data.kind, widgetId: newId });
      setSelectedWidgetId(newId);
      return;
    }
    // page-bottom — dormant in v1: no droppable currently emits this target.
    // A future task can wire a `<div ref={setNodeRef}>` at the bottom of each
    // page in canvas.tsx with data { kind: "page-bottom", pageId }; the handler
    // here is structurally ready. The setTimeout + last-row lookup is a known
    // wart pending an `ADD_ROW.rowId` reducer signature.
    if (target.kind === "page-bottom") {
      // page-bottom — append a new 1-up row, then place
      dispatch({ type: "ADD_ROW", pageId: target.pageId, layout: "1-up" });
      // The action handlers don't return ids; for now use a local effect:
      setTimeout(() => {
        // safe: state updates synchronously; reducer creates row with the new id we just added
        const page = state.pages.find((p) => p.id === target.pageId);
        const lastRow = page?.rows[page.rows.length - 1];
        if (!lastRow) return;
        dispatch({ type: "ADD_WIDGET_TO_SLOT", pageId: target.pageId, rowId: lastRow.id,
                   slotIndex: 0, kind: data.kind, widgetId: newId });
      }, 0);
      setSelectedWidgetId(newId);
    }
  }, [state.pages]);

  const handleExport = useCallback(async () => {
    const chartImages: Record<string, string> = {};
    document
      .querySelectorAll<HTMLCanvasElement>("[data-widget-canvas]")
      .forEach((c) => {
        const id = c.dataset.widgetId;
        if (!id) return;
        const png = canvasToPng(c);
        if (png) chartImages[id] = png;
      });
    const res = await fetch(
      `/api/clients/${clientId}/reports/${reportId}/export-pdf`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chartImages }),
      },
    );
    if (!res.ok) {
      alert("Export failed");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${state.title}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }, [clientId, reportId, state.title]);

  return (
    <ReportBuilderContext value={{ household }}>
      <DndContext onDragEnd={handleDragEnd}>
        <KeyboardShortcuts
          selectedWidgetId={selectedWidgetId}
          setSelectedWidgetId={setSelectedWidgetId}
          dispatch={dispatch}
          pages={state.pages}
          clipboardRef={clipboardRef}
        />
        <div className="flex flex-col h-screen bg-paper">
          <TopBar
            clientId={clientId}
            householdName={householdName}
            title={state.title}
            onTitleChange={(t) => dispatch({ type: "SET_TITLE", title: t })}
            status={status}
            onExport={handleExport}
          />
          <div className="flex flex-1 overflow-hidden">
            <BlockLibrary />
            <Canvas
              pages={state.pages}
              dispatch={dispatch}
              selectedWidgetId={selectedWidgetId}
              onSelectWidget={setSelectedWidgetId}
            />
            <Inspector
              pages={state.pages}
              selectedWidgetId={selectedWidgetId}
              dispatch={dispatch}
            />
          </div>
        </div>
      </DndContext>
    </ReportBuilderContext>
  );
}
