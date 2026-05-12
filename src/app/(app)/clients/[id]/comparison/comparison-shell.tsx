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
import type { ComparisonLayoutV5, WidgetInstance } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import { useLayout } from "./use-layout";
import { useSharedMcRun } from "./use-shared-mc-run";
import { usePreviewPlans } from "./use-preview-plans";
import { WidgetRenderer } from "./widget-renderer";
import { CanvasGroup } from "./canvas-group";
import { ReportTitle } from "./report-title";
import { ModeToggle, type CanvasMode } from "./mode-toggle";
import { SaveStatus } from "./save-status";
import { WidgetConfigModal } from "./widget-config-modal";

interface Props {
  clientId: string;
  initialLayout: ComparisonLayoutV5;
  scenarios: { id: string; name: string }[];
  primaryScenarioId: string;
}

function uniquePlanIds(layout: ComparisonLayoutV5): string[] {
  const set = new Set<string>();
  for (const g of layout.groups) {
    for (const c of g.cells) {
      if (!c.widget) continue;
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
  const [editingCellId, setEditingCellId] = useState<string | null>(null);
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
    api.layout.groups.some((g) =>
      g.cells.some((c) => c.widget && COMPARISON_WIDGETS[c.widget.kind].needsMc),
    );

  const mcState = useSharedMcRun({ clientId, plans: previewPlans, enabled: mcEnabled });
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
    const aData = active.data.current as { type: "group" } | { type: "cell"; groupId: string } | undefined;
    const oData = over.data.current as { type: "group" } | { type: "cell"; groupId: string } | undefined;
    if (!aData || !oData) return;

    if (aData.type === "group" && oData.type === "group") {
      const from = api.layout.groups.findIndex((g) => g.id === active.id);
      const to = api.layout.groups.findIndex((g) => g.id === over.id);
      if (from >= 0 && to >= 0) api.moveGroup(from, to);
      return;
    }
    if (aData.type === "cell" && oData.type === "cell") {
      const fromGroup = api.layout.groups.find((g) => g.id === aData.groupId);
      const toGroup = api.layout.groups.find((g) => g.id === oData.groupId);
      if (!fromGroup || !toGroup) return;
      const fromIdx = fromGroup.cells.findIndex((c) => c.id === active.id);
      const toIdx = toGroup.cells.findIndex((c) => c.id === over.id);
      if (fromIdx < 0 || toIdx < 0) return;
      api.moveCell(aData.groupId, fromIdx, oData.groupId, toIdx);
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

  const editingCell = api.layout.groups
    .flatMap((g) => g.cells)
    .find((c) => c.id === editingCellId) ?? null;

  const handleModalSave = (widget: WidgetInstance) => {
    if (!editingCellId) return;
    api.setCellWidget(editingCellId, widget);
    setEditingCellId(null);
  };

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
            <div className="flex flex-col gap-4 px-4 py-4">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={api.layout.groups.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                  {api.layout.groups.map((group) => (
                    <CanvasGroup
                      key={group.id}
                      group={group}
                      scenarios={scenarios}
                      onSetTitle={(title) => api.setGroupTitle(group.id, title)}
                      onRemoveGroup={() => api.removeGroup(group.id)}
                      onAddWidget={(cellId) => setEditingCellId(cellId)}
                      onEditWidget={(cellId) => setEditingCellId(cellId)}
                      onRemoveCell={(cellId) => api.removeCell(group.id, cellId)}
                      onDuplicateCell={(cellId) => api.duplicateCell(group.id, cellId)}
                      onAddRight={(cellId) => api.addEmptyCellRight(group.id, cellId)}
                      onAddDown={(cellId) => api.addEmptyCellDown(group.id, cellId)}
                      onChangeSpan={(cellId, span) => api.setCellSpan(cellId, span)}
                    />
                  ))}
                </SortableContext>
              </DndContext>
              <button
                type="button"
                onClick={() => api.addGroup()}
                className="self-start rounded-full border border-dashed border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                + New group
              </button>
            </div>
          ) : preview.status === "loading" ? (
            <div className="px-6 py-16 text-center text-slate-400">Loading plan data…</div>
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
      </div>

      {editingCell && (
        editingCell.widget ? (
          <WidgetConfigModal
            mode="edit"
            widget={editingCell.widget}
            scenarios={scenarios}
            availableYearRange={availableYearRange}
            primaryScenarioId={primaryScenarioId}
            onSave={handleModalSave}
            onClose={() => setEditingCellId(null)}
          />
        ) : (
          <WidgetConfigModal
            mode="create"
            scenarios={scenarios}
            availableYearRange={availableYearRange}
            primaryScenarioId={primaryScenarioId}
            onSave={handleModalSave}
            onClose={() => setEditingCellId(null)}
          />
        )
      )}
    </>
  );
}
