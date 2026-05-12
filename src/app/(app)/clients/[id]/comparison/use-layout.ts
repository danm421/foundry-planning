"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  Cell,
  ComparisonLayoutV4,
  ComparisonWidgetKindV4,
  Row,
  WidgetInstance,
  YearRange,
} from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import { getDefaultLayoutV4 } from "@/lib/comparison/widgets/default-layout-v4";

const newId = (): string => crypto.randomUUID();

const MAX_CELLS_PER_ROW = 5;

export interface AddRowResult {
  rowId: string;
  placeholderCellId: string;
}

export interface UseLayoutApi {
  layout: ComparisonLayoutV4;
  setTitle: (title: string) => void;
  addRow: () => AddRowResult;
  removeRow: (rowId: string) => void;
  moveRow: (fromIndex: number, toIndex: number) => void;
  addCell: (rowId: string, kind: ComparisonWidgetKindV4) => void;
  removeCell: (rowId: string, cellId: string) => void;
  moveCell: (
    fromRowId: string, fromIndex: number,
    toRowId: string, toIndex: number,
  ) => void;
  updateWidgetPlanIds: (cellId: string, planIds: string[]) => void;
  updateWidgetYearRange: (cellId: string, yearRange: YearRange | undefined) => void;
  updateWidgetConfig: (cellId: string, config: unknown) => void;
  updateTextMarkdown: (cellId: string, markdown: string) => void;
  reset: (primaryScenarioId: string) => void;
  save: () => Promise<void>;
  saving: boolean;
}

function defaultPlanIdsFor(
  kind: ComparisonWidgetKindV4,
  primary: string,
): string[] {
  const def = COMPARISON_WIDGETS[kind];
  switch (def.scenarios) {
    case "none":
      return [];
    case "one":
      return [primary];
    case "one-or-many":
      return [primary];
    case "many-only":
      return [primary, primary]; // advisor must pick a second scenario before save
  }
}

function buildWidget(
  kind: ComparisonWidgetKindV4,
  primary: string,
): WidgetInstance {
  const def = COMPARISON_WIDGETS[kind];
  const widget: WidgetInstance = {
    id: newId(),
    kind,
    planIds: defaultPlanIdsFor(kind, primary),
  };
  if (def.defaultConfig !== undefined) widget.config = def.defaultConfig;
  if (kind === "text" && widget.config === undefined) widget.config = { markdown: "" };
  return widget;
}

function makeCell(widget: WidgetInstance): Cell {
  return { id: newId(), widget };
}

function makeRow(cells: Cell[]): Row {
  return { id: newId(), cells };
}

function mapRow(layout: ComparisonLayoutV4, rowId: string, f: (r: Row) => Row): ComparisonLayoutV4 {
  return { ...layout, rows: layout.rows.map((r) => (r.id === rowId ? f(r) : r)) };
}

function mapCellById(
  layout: ComparisonLayoutV4,
  cellId: string,
  f: (c: Cell) => Cell,
): ComparisonLayoutV4 {
  return {
    ...layout,
    rows: layout.rows.map((r) => ({
      ...r,
      cells: r.cells.map((c) => (c.id === cellId ? f(c) : c)),
    })),
  };
}

export function useLayout(initial: ComparisonLayoutV4, clientId: string): UseLayoutApi {
  const [layout, setLayout] = useState<ComparisonLayoutV4>(initial);
  const [saving, setSaving] = useState(false);

  const setTitle = useCallback((title: string) => {
    setLayout((p) => (p.title === title ? p : { ...p, title }));
  }, []);

  const addRow = useCallback((): AddRowResult => {
    const placeholder = makeCell({
      id: newId(),
      kind: "text",
      planIds: [],
      config: { markdown: "" },
    });
    const row = makeRow([placeholder]);
    setLayout((p) => ({ ...p, rows: [...p.rows, row] }));
    return { rowId: row.id, placeholderCellId: placeholder.id };
  }, []);

  const removeRow = useCallback((rowId: string) => {
    setLayout((p) => ({ ...p, rows: p.rows.filter((r) => r.id !== rowId) }));
  }, []);

  const moveRow = useCallback((fromIndex: number, toIndex: number) => {
    setLayout((p) => {
      if (fromIndex === toIndex) return p;
      const rows = [...p.rows];
      const [m] = rows.splice(fromIndex, 1);
      rows.splice(toIndex, 0, m);
      return { ...p, rows };
    });
  }, []);

  const addCell = useCallback(
    (rowId: string, kind: ComparisonWidgetKindV4) => {
      setLayout((p) => {
        const target = p.rows.find((r) => r.id === rowId);
        if (!target || target.cells.length >= MAX_CELLS_PER_ROW) return p;
        // Primary scenario is the first planId of the first widget in the layout
        // (falls back to "base" when the layout is empty / has only text widgets).
        const firstWidgetPlan =
          p.rows
            .flatMap((r) => r.cells.map((c) => c.widget))
            .find((w) => w.planIds.length > 0)?.planIds[0] ?? "base";
        const cell = makeCell(buildWidget(kind, firstWidgetPlan));
        return mapRow(p, rowId, (r) => ({ ...r, cells: [...r.cells, cell] }));
      });
    },
    [],
  );

  const removeCell = useCallback((rowId: string, cellId: string) => {
    setLayout((p) => {
      const row = p.rows.find((r) => r.id === rowId);
      if (!row) return p;
      const remaining = row.cells.filter((c) => c.id !== cellId);
      if (remaining.length === 0) {
        return { ...p, rows: p.rows.filter((r) => r.id !== rowId) };
      }
      return mapRow(p, rowId, (r) => ({ ...r, cells: remaining }));
    });
  }, []);

  const moveCell = useCallback(
    (fromRowId: string, fromIndex: number, toRowId: string, toIndex: number) => {
      setLayout((p) => {
        const fromRow = p.rows.find((r) => r.id === fromRowId);
        if (!fromRow) return p;
        const cell = fromRow.cells[fromIndex];
        if (!cell) return p;

        if (fromRowId === toRowId) {
          if (fromIndex === toIndex) return p;
          const cells = [...fromRow.cells];
          const [m] = cells.splice(fromIndex, 1);
          cells.splice(Math.min(toIndex, cells.length), 0, m);
          return mapRow(p, fromRowId, (r) => ({ ...r, cells }));
        }

        const toRow = p.rows.find((r) => r.id === toRowId);
        if (!toRow || toRow.cells.length >= MAX_CELLS_PER_ROW) return p;
        const fromCells = fromRow.cells.filter((c) => c.id !== cell.id);
        const toCells = [...toRow.cells];
        toCells.splice(Math.min(toIndex, toCells.length), 0, cell);
        let rows = p.rows.map((r) => {
          if (r.id === fromRowId) return { ...r, cells: fromCells };
          if (r.id === toRowId) return { ...r, cells: toCells };
          return r;
        });
        // Auto-delete the source row if it's now empty.
        rows = rows.filter((r) => r.cells.length > 0);
        return { ...p, rows };
      });
    },
    [],
  );

  const updateWidgetPlanIds = useCallback((cellId: string, planIds: string[]) => {
    setLayout((p) =>
      mapCellById(p, cellId, (c) => ({ ...c, widget: { ...c.widget, planIds } })),
    );
  }, []);

  const updateWidgetYearRange = useCallback(
    (cellId: string, yearRange: YearRange | undefined) => {
      setLayout((p) =>
        mapCellById(p, cellId, (c) => {
          const w = { ...c.widget };
          if (yearRange === undefined) delete w.yearRange;
          else w.yearRange = yearRange;
          return { ...c, widget: w };
        }),
      );
    },
    [],
  );

  const updateWidgetConfig = useCallback((cellId: string, config: unknown) => {
    setLayout((p) =>
      mapCellById(p, cellId, (c) => ({ ...c, widget: { ...c.widget, config } })),
    );
  }, []);

  const updateTextMarkdown = useCallback((cellId: string, markdown: string) => {
    setLayout((p) =>
      mapCellById(p, cellId, (c) => ({
        ...c,
        widget: { ...c.widget, config: { markdown } },
      })),
    );
  }, []);

  const reset = useCallback((primaryScenarioId: string) => {
    setLayout(getDefaultLayoutV4({ primaryScenarioId }));
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const rows = layout.rows
        .map((r) => ({
          ...r,
          cells: r.cells.filter((c) => {
            if (c.widget.kind !== "text") return true;
            const md = (c.widget.config as { markdown?: string } | undefined)?.markdown ?? "";
            return md.trim() !== "";
          }),
        }))
        .filter((r) => r.cells.length > 0);
      const trimmed: ComparisonLayoutV4 = { ...layout, rows };
      const res = await fetch(`/api/clients/${clientId}/comparison-layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(trimmed),
      });
      if (!res.ok) throw new Error(`Layout save failed: ${res.status}`);
    } finally {
      setSaving(false);
    }
  }, [clientId, layout]);

  return useMemo(
    () => ({
      layout,
      setTitle,
      addRow, removeRow, moveRow,
      addCell, removeCell, moveCell,
      updateWidgetPlanIds, updateWidgetYearRange, updateWidgetConfig,
      updateTextMarkdown,
      reset, save, saving,
    }),
    [
      layout, setTitle, addRow, removeRow, moveRow, addCell, removeCell, moveCell,
      updateWidgetPlanIds, updateWidgetYearRange, updateWidgetConfig,
      updateTextMarkdown, reset, save, saving,
    ],
  );
}
