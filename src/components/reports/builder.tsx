// src/components/reports/builder.tsx
//
// Client root of the report builder. Holds the reducer state, the
// currently-selected widget id, and renders the 3-pane layout.

"use client";
import "@/lib/reports/widgets";
import { useCallback, useReducer, useState } from "react";
import { DndContext, type DragEndEvent } from "@dnd-kit/core";
import { reducer, type ReportState } from "@/lib/reports/reducer";
import { ReportBuilderContext, type Household } from "./builder-context";
import { TopBar } from "./top-bar";
import { BlockLibrary } from "./block-library";
import { Canvas } from "./canvas";
import { Inspector } from "./inspector";
import { useAutosave } from "./use-autosave";
import { canvasToPng } from "@/components/reports-pdf/chart-to-image";
import type { Page, WidgetKind } from "@/lib/reports/types";

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
  const status = useAutosave({
    clientId,
    reportId,
    state,
    initial: initial as ReportState,
  });

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    if (!e.over) return;
    const data = e.active.data.current as { source: "library"; kind: WidgetKind } | undefined;
    const target = e.over.data.current as
      | { kind: "slot"; pageId: string; rowId: string; slotIndex: number }
      | { kind: "page-bottom"; pageId: string }
      | undefined;
    if (!data || data.source !== "library" || !target) return;
    const newId = crypto.randomUUID();
    if (target.kind === "slot") {
      dispatch({ type: "ADD_WIDGET_TO_SLOT", pageId: target.pageId, rowId: target.rowId,
                 slotIndex: target.slotIndex, kind: data.kind, widgetId: newId });
    // page-bottom — dormant in v1: no droppable currently emits this target.
    // A future task can wire a `<div ref={setNodeRef}>` at the bottom of each
    // page in canvas.tsx with data { kind: "page-bottom", pageId }; the handler
    // here is structurally ready. The setTimeout + last-row lookup is a known
    // wart pending an `ADD_ROW.rowId` reducer signature.
    } else {
      // page-bottom — append a new 1-up row, then place
      const tempRowId = crypto.randomUUID();
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
      void tempRowId;
    }
    setSelectedWidgetId(newId);
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
