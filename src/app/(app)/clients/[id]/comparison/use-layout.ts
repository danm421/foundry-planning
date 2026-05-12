"use client";

import { useCallback, useMemo, useState } from "react";
import type {
  CellSpan,
  CellV5,
  ComparisonLayoutV5,
  Group,
  WidgetInstance,
  YearRange,
} from "@/lib/comparison/layout-schema";
import { findEndOfVisualRowIndex } from "@/lib/comparison/v5-grid";

const newId = (): string => globalThis.crypto.randomUUID();

export interface UseLayoutApi {
  layout: ComparisonLayoutV5;
  setTitle: (title: string) => void;

  addGroup: () => { groupId: string; cellId: string };
  removeGroup: (groupId: string) => void;
  setGroupTitle: (groupId: string, title: string) => void;
  moveGroup: (fromIndex: number, toIndex: number) => void;

  addEmptyCellRight: (groupId: string, afterCellId: string) => string;
  addEmptyCellDown: (groupId: string, afterCellId: string) => string;
  removeCell: (groupId: string, cellId: string) => void;
  setCellSpan: (cellId: string, span: CellSpan) => void;
  setCellWidget: (cellId: string, widget: WidgetInstance) => void;
  duplicateCell: (groupId: string, cellId: string) => void;
  moveCell: (fromGroupId: string, fromIndex: number, toGroupId: string, toIndex: number) => void;

  updateWidgetPlanIds: (cellId: string, planIds: string[]) => void;
  updateWidgetYearRange: (cellId: string, yearRange: YearRange | undefined) => void;
  updateWidgetConfig: (cellId: string, config: unknown) => void;
  updateTextMarkdown: (cellId: string, markdown: string) => void;

  save: () => Promise<void>;
  saving: boolean;
  dirty: boolean;
}

function makeEmptyCell(span: CellSpan = 5): CellV5 {
  return { id: newId(), span, widget: null };
}

function makeGroup(cells: CellV5[]): Group {
  return { id: newId(), title: "", cells };
}

function mapGroup(layout: ComparisonLayoutV5, groupId: string, f: (g: Group) => Group): ComparisonLayoutV5 {
  return { ...layout, groups: layout.groups.map((g) => (g.id === groupId ? f(g) : g)) };
}

function mapCellById(layout: ComparisonLayoutV5, cellId: string, f: (c: CellV5) => CellV5): ComparisonLayoutV5 {
  return {
    ...layout,
    groups: layout.groups.map((g) => ({
      ...g,
      cells: g.cells.map((c) => (c.id === cellId ? f(c) : c)),
    })),
  };
}

export function useLayout(initial: ComparisonLayoutV5, clientId: string): UseLayoutApi {
  const [layout, setLayout] = useState<ComparisonLayoutV5>(initial);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const setTitle = useCallback((title: string) => {
    setLayout((p) => (p.title === title ? p : { ...p, title }));
    setDirty(true);
  }, []);

  const addGroup = useCallback(() => {
    const cell = makeEmptyCell(5);
    const group = makeGroup([cell]);
    setLayout((p) => ({ ...p, groups: [...p.groups, group] }));
    setDirty(true);
    return { groupId: group.id, cellId: cell.id };
  }, []);

  const removeGroup = useCallback((groupId: string) => {
    setLayout((p) => ({ ...p, groups: p.groups.filter((g) => g.id !== groupId) }));
    setDirty(true);
  }, []);

  const setGroupTitle = useCallback((groupId: string, title: string) => {
    setLayout((p) => mapGroup(p, groupId, (g) => (g.title === title ? g : { ...g, title })));
    setDirty(true);
  }, []);

  const moveGroup = useCallback((fromIndex: number, toIndex: number) => {
    setLayout((p) => {
      if (fromIndex === toIndex) return p;
      const groups = [...p.groups];
      const [m] = groups.splice(fromIndex, 1);
      groups.splice(toIndex, 0, m);
      return { ...p, groups };
    });
    setDirty(true);
  }, []);

  const addEmptyCellRight = useCallback((groupId: string, afterCellId: string): string => {
    const cell = makeEmptyCell(1);
    setLayout((p) =>
      mapGroup(p, groupId, (g) => {
        const i = g.cells.findIndex((c) => c.id === afterCellId);
        if (i < 0) return g;
        const cells = [...g.cells.slice(0, i + 1), cell, ...g.cells.slice(i + 1)];
        return { ...g, cells };
      }),
    );
    setDirty(true);
    return cell.id;
  }, []);

  const addEmptyCellDown = useCallback((groupId: string, afterCellId: string): string => {
    const cell = makeEmptyCell(5);
    setLayout((p) =>
      mapGroup(p, groupId, (g) => {
        const i = g.cells.findIndex((c) => c.id === afterCellId);
        if (i < 0) return g;
        const insertAt = findEndOfVisualRowIndex(g.cells, i);
        const cells = [...g.cells.slice(0, insertAt), cell, ...g.cells.slice(insertAt)];
        return { ...g, cells };
      }),
    );
    setDirty(true);
    return cell.id;
  }, []);

  const removeCell = useCallback((groupId: string, cellId: string) => {
    setLayout((p) =>
      mapGroup(p, groupId, (g) => {
        const target = g.cells.find((c) => c.id === cellId);
        if (!target) return g;
        if (target.widget !== null) {
          // Replace populated cell with an empty placeholder, preserving span.
          return {
            ...g,
            cells: g.cells.map((c) => (c.id === cellId ? { ...c, widget: null } : c)),
          };
        }
        return { ...g, cells: g.cells.filter((c) => c.id !== cellId) };
      }),
    );
    setDirty(true);
  }, []);

  const setCellSpan = useCallback((cellId: string, span: CellSpan) => {
    setLayout((p) => mapCellById(p, cellId, (c) => ({ ...c, span })));
    setDirty(true);
  }, []);

  const setCellWidget = useCallback((cellId: string, widget: WidgetInstance) => {
    setLayout((p) => mapCellById(p, cellId, (c) => ({ ...c, widget })));
    setDirty(true);
  }, []);

  const duplicateCell = useCallback((groupId: string, cellId: string) => {
    setLayout((p) =>
      mapGroup(p, groupId, (g) => {
        const i = g.cells.findIndex((c) => c.id === cellId);
        if (i < 0) return g;
        const src = g.cells[i];
        if (!src.widget) return g;
        const cloneWidget: WidgetInstance = {
          ...src.widget,
          id: newId(),
          planIds: [...src.widget.planIds],
        };
        if (src.widget.yearRange) cloneWidget.yearRange = { ...src.widget.yearRange };
        if (src.widget.config !== undefined) {
          cloneWidget.config = JSON.parse(JSON.stringify(src.widget.config));
        }
        const clone: CellV5 = { id: newId(), span: src.span, widget: cloneWidget };
        return { ...g, cells: [...g.cells.slice(0, i + 1), clone, ...g.cells.slice(i + 1)] };
      }),
    );
    setDirty(true);
  }, []);

  const moveCell = useCallback(
    (fromGroupId: string, fromIndex: number, toGroupId: string, toIndex: number) => {
      setLayout((p) => {
        const fromGroup = p.groups.find((g) => g.id === fromGroupId);
        if (!fromGroup) return p;
        const cell = fromGroup.cells[fromIndex];
        if (!cell) return p;

        if (fromGroupId === toGroupId) {
          if (fromIndex === toIndex) return p;
          const cells = [...fromGroup.cells];
          const [m] = cells.splice(fromIndex, 1);
          cells.splice(Math.min(toIndex, cells.length), 0, m);
          return mapGroup(p, fromGroupId, (g) => ({ ...g, cells }));
        }

        const toGroup = p.groups.find((g) => g.id === toGroupId);
        if (!toGroup) return p;
        const fromCells = fromGroup.cells.filter((c) => c.id !== cell.id);
        const toCells = [...toGroup.cells];
        toCells.splice(Math.min(toIndex, toCells.length), 0, cell);
        let groups = p.groups.map((g) => {
          if (g.id === fromGroupId) return { ...g, cells: fromCells };
          if (g.id === toGroupId) return { ...g, cells: toCells };
          return g;
        });
        groups = groups.filter((g) => g.cells.length > 0);
        return { ...p, groups };
      });
      setDirty(true);
    },
    [],
  );

  const updateWidgetPlanIds = useCallback((cellId: string, planIds: string[]) => {
    setLayout((p) =>
      mapCellById(p, cellId, (c) =>
        c.widget ? { ...c, widget: { ...c.widget, planIds } } : c,
      ),
    );
    setDirty(true);
  }, []);

  const updateWidgetYearRange = useCallback(
    (cellId: string, yearRange: YearRange | undefined) => {
      setLayout((p) =>
        mapCellById(p, cellId, (c) => {
          if (!c.widget) return c;
          const w = { ...c.widget };
          if (yearRange === undefined) delete w.yearRange;
          else w.yearRange = yearRange;
          return { ...c, widget: w };
        }),
      );
      setDirty(true);
    },
    [],
  );

  const updateWidgetConfig = useCallback((cellId: string, config: unknown) => {
    setLayout((p) =>
      mapCellById(p, cellId, (c) =>
        c.widget ? { ...c, widget: { ...c.widget, config } } : c,
      ),
    );
    setDirty(true);
  }, []);

  const updateTextMarkdown = useCallback((cellId: string, markdown: string) => {
    setLayout((p) =>
      mapCellById(p, cellId, (c) =>
        c.widget ? { ...c, widget: { ...c.widget, config: { markdown } } } : c,
      ),
    );
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/comparison-layout`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(layout),
      });
      if (!res.ok) throw new Error(`Layout save failed: ${res.status}`);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [clientId, layout]);

  return useMemo(
    () => ({
      layout,
      setTitle,
      addGroup, removeGroup, setGroupTitle, moveGroup,
      addEmptyCellRight, addEmptyCellDown, removeCell, setCellSpan, setCellWidget, duplicateCell, moveCell,
      updateWidgetPlanIds, updateWidgetYearRange, updateWidgetConfig, updateTextMarkdown,
      save, saving, dirty,
    }),
    [
      layout, setTitle, addGroup, removeGroup, setGroupTitle, moveGroup,
      addEmptyCellRight, addEmptyCellDown, removeCell, setCellSpan, setCellWidget, duplicateCell, moveCell,
      updateWidgetPlanIds, updateWidgetYearRange, updateWidgetConfig, updateTextMarkdown,
      save, saving, dirty,
    ],
  );
}
