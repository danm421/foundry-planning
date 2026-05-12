"use client";

import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  type DragEndEvent,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { ComparisonLayoutV4 } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import { useLayout } from "./use-layout";
import { useSharedMcRun } from "./use-shared-mc-run";
import { usePreviewPlans } from "./use-preview-plans";
import { WidgetRenderer } from "./widget-renderer";
import { WidgetPicker } from "./widget-picker";
import { CanvasRow } from "./canvas-row";
import { ReportTitle } from "./report-title";
import { ModeToggle, type CanvasMode } from "./mode-toggle";
import { SaveStatus } from "./save-status";
import { WidgetConfigPopover } from "./widget-config-popover";

interface Props {
  clientId: string;
  initialLayout: ComparisonLayoutV4;
  scenarios: { id: string; name: string }[];
  primaryScenarioId: string;
}

function uniquePlanIds(layout: ComparisonLayoutV4): string[] {
  const set = new Set<string>();
  for (const r of layout.rows) {
    for (const c of r.cells) {
      for (const pid of c.widget.planIds) set.add(pid);
    }
  }
  return Array.from(set);
}

export function ComparisonShell({
  clientId,
  initialLayout,
  scenarios,
  primaryScenarioId,
}: Props) {
  const api = useLayout(initialLayout, clientId);
  const [mode, setMode] = useState<CanvasMode>("layout");
  const [openCellId, setOpenCellId] = useState<string | null>(null);
  const [openAnchor, setOpenAnchor] = useState<HTMLElement | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const planIds = useMemo(() => uniquePlanIds(api.layout), [api.layout]);

  const preview = usePreviewPlans({
    clientId,
    planIds,
    enabled: mode === "preview",
  });

  const previewPlans = useMemo(
    () => (preview.status === "ready" ? preview.plans ?? [] : []),
    [preview],
  );

  const mcEnabled =
    mode === "preview" &&
    api.layout.rows.some((r) =>
      r.cells.some((c) => COMPARISON_WIDGETS[c.widget.kind].needsMc),
    );

  const mcState = useSharedMcRun({
    clientId,
    plans: previewPlans,
    enabled: mcEnabled,
  });
  const mc = mcState.status === "ready" ? mcState.result ?? null : null;

  const availableYearRange = useMemo(() => {
    const years = previewPlans.flatMap((p) => p.result.years.map((y) => y.year));
    if (years.length === 0) {
      const yr = new Date().getFullYear();
      return { min: yr, max: yr + 30 };
    }
    return { min: Math.min(...years), max: Math.max(...years) };
  }, [previewPlans]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragEnd = useCallback((e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const aData = active.data.current as { type: "row" } | { type: "cell"; rowId: string } | undefined;
    const oData = over.data.current as { type: "row" } | { type: "cell"; rowId: string } | undefined;
    if (!aData || !oData) return;

    if (aData.type === "row" && oData.type === "row") {
      const from = api.layout.rows.findIndex((r) => r.id === active.id);
      const to = api.layout.rows.findIndex((r) => r.id === over.id);
      if (from >= 0 && to >= 0) api.moveRow(from, to);
      return;
    }
    if (aData.type === "cell" && oData.type === "cell") {
      const fromRow = api.layout.rows.find((r) => r.id === aData.rowId);
      const toRow = api.layout.rows.find((r) => r.id === oData.rowId);
      if (!fromRow || !toRow) return;
      const fromIdx = fromRow.cells.findIndex((c) => c.id === active.id);
      const toIdx = toRow.cells.findIndex((c) => c.id === over.id);
      if (fromIdx < 0 || toIdx < 0) return;
      api.moveCell(aData.rowId, fromIdx, oData.rowId, toIdx);
    }
  }, [api]);

  const handleSave = useCallback(async () => {
    setSaveError(null);
    try {
      await api.save();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "save failed");
    }
  }, [api]);

  const openCell =
    api.layout.rows.flatMap((r) => r.cells).find((c) => c.id === openCellId) ?? null;

  return (
    <>
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-3 backdrop-blur">
        <ReportTitle value={api.layout.title} onChange={api.setTitle} />
        <ModeToggle mode={mode} onChange={setMode} />
        <div className="ml-auto">
          <SaveStatus
            dirty={api.dirty}
            saving={api.saving}
            error={saveError}
            onSave={handleSave}
          />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          {mode === "layout" ? (
            <div className="flex flex-col gap-2 px-4 py-4">
              {api.layout.rows.length === 0 ? (
                <div className="px-2 py-16 text-center text-slate-400">
                  No widgets — pick one from the right.
                </div>
              ) : (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={api.layout.rows.map((r) => r.id)} strategy={verticalListSortingStrategy}>
                    {api.layout.rows.map((row, rowIdx) => (
                      <CanvasRow
                        key={row.id}
                        row={row}
                        scenarios={scenarios}
                        onEditCell={(cellId) => {
                          setOpenCellId(cellId);
                          const widgetId = row.cells.find((c) => c.id === cellId)?.widget.id;
                          const el = widgetId
                            ? document.querySelector(`[data-widget-card="${widgetId}"]`)
                            : null;
                          setOpenAnchor(el instanceof HTMLElement ? el : null);
                        }}
                        onRemoveCell={(rowId, cellId) => api.removeCell(rowId, cellId)}
                        onAddCell={(rowId) => api.addCell(rowId, "text")}
                        onDeleteRow={(rowId) => api.removeRow(rowId)}
                        onDuplicateCell={(rowId, cellId) => api.duplicateCell(rowId, cellId)}
                        onMoveCellLeft={(rowId, cellId) => {
                          const r = api.layout.rows.find((row) => row.id === rowId);
                          const idx = r?.cells.findIndex((c) => c.id === cellId) ?? -1;
                          if (idx > 0) api.moveCell(rowId, idx, rowId, idx - 1);
                        }}
                        onMoveCellRight={(rowId, cellId) => {
                          const r = api.layout.rows.find((row) => row.id === rowId);
                          const idx = r?.cells.findIndex((c) => c.id === cellId) ?? -1;
                          if (r && idx >= 0 && idx < r.cells.length - 1) api.moveCell(rowId, idx, rowId, idx + 1);
                        }}
                        onMoveUp={() => api.moveRow(rowIdx, rowIdx - 1)}
                        onMoveDown={() => api.moveRow(rowIdx, rowIdx + 1)}
                        canMoveUp={rowIdx > 0}
                        canMoveDown={rowIdx < api.layout.rows.length - 1}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              )}
              <button
                type="button"
                onClick={() => api.addRow()}
                className="self-start rounded border border-dashed border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800"
              >
                + Add row
              </button>
            </div>
          ) : preview.status === "loading" ? (
            <div className="px-6 py-16 text-center text-slate-400">
              Loading plan data…
            </div>
          ) : preview.status === "error" ? (
            <div className="px-6 py-16 text-center text-red-400">
              Couldn&apos;t load plan data: {preview.error}
            </div>
          ) : (
            <WidgetRenderer
              layout={api.layout}
              clientId={clientId}
              plans={previewPlans}
              mc={mc}
            />
          )}
        </div>

        {mode === "layout" && (
          <WidgetPicker api={api} primaryScenarioId={primaryScenarioId} />
        )}
      </div>

      {openCell && (
        <WidgetConfigPopover
          anchor={openAnchor}
          widget={openCell.widget}
          scenarios={scenarios}
          availableYearRange={availableYearRange}
          onChangePlanIds={(ids) => api.updateWidgetPlanIds(openCell.id, ids)}
          onChangeYearRange={(yr) => api.updateWidgetYearRange(openCell.id, yr)}
          onChangeConfig={(cfg) => api.updateWidgetConfig(openCell.id, cfg)}
          onClose={() => {
            setOpenCellId(null);
            setOpenAnchor(null);
          }}
        />
      )}
    </>
  );
}
