// src/lib/reports/reducer.ts
import type { Page, Row, RowSize, Widget, WidgetKind } from "./types";
import { SLOT_COUNT_BY_LAYOUT } from "./types";
import { makeWidget } from "./widget-registry";

export type Action =
  | { type: "ADD_PAGE"; orientation: "portrait" | "landscape"; afterPageId?: string }
  | { type: "DELETE_PAGE"; pageId: string }
  | { type: "REORDER_PAGES"; from: number; to: number }
  | { type: "TOGGLE_PAGE_ORIENTATION"; pageId: string }
  | { type: "DUPLICATE_PAGE"; pageId: string }
  | { type: "ADD_ROW"; pageId: string; index?: number; layout?: RowSize }
  | { type: "DELETE_ROW"; pageId: string; rowId: string }
  | { type: "REORDER_ROWS"; pageId: string; from: number; to: number }
  | { type: "UPDATE_ROW_LAYOUT"; pageId: string; rowId: string; layout: RowSize }
  | { type: "ADD_WIDGET_TO_SLOT"; pageId: string; rowId: string; slotIndex: number; kind: WidgetKind; widgetId: string }
  | { type: "REPLACE_WIDGET"; pageId: string; rowId: string; slotIndex: number; kind: WidgetKind; widgetId: string }
  | { type: "UPDATE_WIDGET_PROPS"; widgetId: string; props: Widget["props"] }
  | { type: "MOVE_WIDGET"; widgetId: string; toPageId: string; toRowId: string; toSlotIndex: number }
  | { type: "DELETE_WIDGET"; widgetId: string }
  | { type: "DUPLICATE_WIDGET"; widgetId: string; newId: string }
  | { type: "SET_TITLE"; title: string };

export type ReportState = {
  title: string;
  pages: Page[];
};

const emptyRow = (id: string, layout: RowSize = "1-up"): Row => ({
  id, layout, slots: Array(SLOT_COUNT_BY_LAYOUT[layout]).fill(null),
});

function findWidgetLocation(pages: Page[], widgetId: string):
  | { pageIdx: number; rowIdx: number; slotIdx: number }
  | null {
  for (let p = 0; p < pages.length; p++) {
    for (let r = 0; r < pages[p].rows.length; r++) {
      for (let s = 0; s < pages[p].rows[r].slots.length; s++) {
        if (pages[p].rows[r].slots[s]?.id === widgetId) return { pageIdx: p, rowIdx: r, slotIdx: s };
      }
    }
  }
  return null;
}

export function reducer(state: ReportState, action: Action): ReportState {
  switch (action.type) {
    case "SET_TITLE":
      return { ...state, title: action.title };

    case "ADD_PAGE": {
      const newPage: Page = {
        id: crypto.randomUUID(),
        orientation: action.orientation,
        rows: [],
      };
      if (!action.afterPageId) {
        return { ...state, pages: [...state.pages, newPage] };
      }
      const idx = state.pages.findIndex((p) => p.id === action.afterPageId);
      if (idx === -1) return { ...state, pages: [...state.pages, newPage] };
      const next = [...state.pages];
      next.splice(idx + 1, 0, newPage);
      return { ...state, pages: next };
    }

    case "DELETE_PAGE":
      return { ...state, pages: state.pages.filter((p) => p.id !== action.pageId) };

    case "REORDER_PAGES": {
      const next = [...state.pages];
      const [moved] = next.splice(action.from, 1);
      next.splice(action.to, 0, moved);
      return { ...state, pages: next };
    }

    case "TOGGLE_PAGE_ORIENTATION":
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id === action.pageId
            ? { ...p, orientation: p.orientation === "portrait" ? "landscape" : "portrait" }
            : p,
        ),
      };

    case "DUPLICATE_PAGE": {
      const idx = state.pages.findIndex((p) => p.id === action.pageId);
      if (idx === -1) return state;
      const cloned = structuredClone(state.pages[idx]);
      cloned.id = crypto.randomUUID();
      cloned.rows = cloned.rows.map((r) => ({
        ...r,
        id: crypto.randomUUID(),
        slots: r.slots.map((w) => (w ? { ...w, id: crypto.randomUUID() } : null)),
      }));
      const next = [...state.pages];
      next.splice(idx + 1, 0, cloned);
      return { ...state, pages: next };
    }

    case "ADD_ROW":
      return {
        ...state,
        pages: state.pages.map((p) => {
          if (p.id !== action.pageId) return p;
          const row = emptyRow(crypto.randomUUID(), action.layout ?? "1-up");
          const rows = [...p.rows];
          if (action.index === undefined) rows.push(row);
          else rows.splice(action.index, 0, row);
          return { ...p, rows };
        }),
      };

    case "DELETE_ROW":
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id !== action.pageId ? p : { ...p, rows: p.rows.filter((r) => r.id !== action.rowId) },
        ),
      };

    case "REORDER_ROWS":
      return {
        ...state,
        pages: state.pages.map((p) => {
          if (p.id !== action.pageId) return p;
          const rows = [...p.rows];
          const [moved] = rows.splice(action.from, 1);
          rows.splice(action.to, 0, moved);
          return { ...p, rows };
        }),
      };

    case "UPDATE_ROW_LAYOUT":
      return {
        ...state,
        pages: state.pages.map((p) => {
          if (p.id !== action.pageId) return p;
          const rows: Row[] = [];
          for (const r of p.rows) {
            if (r.id !== action.rowId) { rows.push(r); continue; }
            const newCount = SLOT_COUNT_BY_LAYOUT[action.layout];
            const oldSlots = r.slots;
            const keptSlots: (Widget | null)[] = [];
            const bumped: Widget[] = [];
            for (let i = 0; i < oldSlots.length; i++) {
              const w = oldSlots[i];
              if (i < newCount) keptSlots.push(w);
              else if (w) bumped.push(w);
            }
            while (keptSlots.length < newCount) keptSlots.push(null);
            rows.push({ ...r, layout: action.layout, slots: keptSlots });
            // Bumped widgets become new 1-up rows directly below, in slot order.
            for (const w of bumped) {
              rows.push({
                id: crypto.randomUUID(),
                layout: "1-up",
                slots: [w],
              });
            }
          }
          return { ...p, rows };
        }),
      };

    case "ADD_WIDGET_TO_SLOT":
    case "REPLACE_WIDGET":
      return {
        ...state,
        pages: state.pages.map((p) =>
          p.id !== action.pageId ? p : {
            ...p,
            rows: p.rows.map((r) => {
              if (r.id !== action.rowId) return r;
              const slots = [...r.slots];
              slots[action.slotIndex] = makeWidget(action.kind, action.widgetId);
              return { ...r, slots };
            }),
          },
        ),
      };

    case "UPDATE_WIDGET_PROPS":
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          rows: p.rows.map((r) => ({
            ...r,
            slots: r.slots.map((w) =>
              w && w.id === action.widgetId
                ? ({ ...w, props: action.props } as Widget)
                : w,
            ),
          })),
        })),
      };

    case "MOVE_WIDGET": {
      const loc = findWidgetLocation(state.pages, action.widgetId);
      if (!loc) return state;
      const widget = state.pages[loc.pageIdx].rows[loc.rowIdx].slots[loc.slotIdx]!;
      const cleared = state.pages.map((p) => ({
        ...p,
        rows: p.rows.map((r) => ({
          ...r,
          slots: r.slots.map((w) => (w?.id === action.widgetId ? null : w)),
        })),
      }));
      const dropped = cleared.map((p) =>
        p.id !== action.toPageId ? p : {
          ...p,
          rows: p.rows.map((r) => {
            if (r.id !== action.toRowId) return r;
            const slots = [...r.slots];
            slots[action.toSlotIndex] = widget;
            return { ...r, slots };
          }),
        },
      );
      return { ...state, pages: dropped };
    }

    case "DELETE_WIDGET":
      return {
        ...state,
        pages: state.pages.map((p) => ({
          ...p,
          rows: p.rows.map((r) => ({
            ...r,
            slots: r.slots.map((w) => (w?.id === action.widgetId ? null : w)),
          })),
        })),
      };

    case "DUPLICATE_WIDGET": {
      const loc = findWidgetLocation(state.pages, action.widgetId);
      if (!loc) return state;
      const original = state.pages[loc.pageIdx].rows[loc.rowIdx].slots[loc.slotIdx]!;
      const copy: Widget = { ...original, id: action.newId };
      const targetRow = state.pages[loc.pageIdx].rows[loc.rowIdx];
      const emptyIdx = targetRow.slots.findIndex((s) => s === null);
      if (emptyIdx !== -1) {
        return {
          ...state,
          pages: state.pages.map((p, pi) =>
            pi !== loc.pageIdx ? p : {
              ...p,
              rows: p.rows.map((r, ri) => {
                if (ri !== loc.rowIdx) return r;
                const slots = [...r.slots];
                slots[emptyIdx] = copy;
                return { ...r, slots };
              }),
            },
          ),
        };
      }
      // No empty slot — insert a new 1-up row directly below.
      return {
        ...state,
        pages: state.pages.map((p, pi) => {
          if (pi !== loc.pageIdx) return p;
          const rows = [...p.rows];
          rows.splice(loc.rowIdx + 1, 0, {
            id: crypto.randomUUID(),
            layout: "1-up",
            slots: [copy],
          });
          return { ...p, rows };
        }),
      };
    }

    default: {
      const _exhaust: never = action;
      void _exhaust;
      return state;
    }
  }
}
