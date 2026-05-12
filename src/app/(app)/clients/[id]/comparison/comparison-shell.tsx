"use client";

import { useMemo, useState } from "react";
import type { ComparisonLayoutV4 } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import { useLayout } from "./use-layout";
import { useSharedMcRun } from "./use-shared-mc-run";
import { usePreviewPlans } from "./use-preview-plans";
import { WidgetRenderer } from "./widget-renderer";
import { WidgetPanel } from "./widget-picker";
import { CanvasRow } from "./canvas-row";
import { ReportTitle } from "./report-title";
import { ModeToggle, type CanvasMode } from "./mode-toggle";

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
  const [panelOpen, setPanelOpen] = useState(false);

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

  return (
    <>
      <header className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-950/95 px-6 py-3 backdrop-blur">
        <ReportTitle value={api.layout.title} onChange={api.setTitle} />
        <ModeToggle mode={mode} onChange={setMode} />
        <button
          type="button"
          aria-label="Open widget panel"
          onClick={() => setPanelOpen(true)}
          className="ml-auto rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
        >
          ⚙
        </button>
      </header>

      {mode === "layout" ? (
        <div className="flex flex-col gap-2 px-4 py-4">
          {api.layout.rows.length === 0 ? (
            <div className="px-2 py-16 text-center text-slate-400">
              No widgets — open the Widget panel to add some.
            </div>
          ) : (
            api.layout.rows.map((row) => (
              <CanvasRow
                key={row.id}
                row={row}
                scenarios={scenarios}
                onEditCell={() => setPanelOpen(true)}
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
              />
            ))
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

      {panelOpen && (
        <WidgetPanel
          api={api}
          primaryScenarioId={primaryScenarioId}
        />
      )}
    </>
  );
}
