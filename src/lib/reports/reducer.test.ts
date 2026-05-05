// src/lib/reports/reducer.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { reducer, type ReportState } from "./reducer";
import { registerWidget } from "./widget-registry";

beforeAll(() => {
  // Register a stub widget so makeWidget() works in reducer tests.
  registerWidget({
    kind: "kpiTile",
    category: "KPI",
    label: "KPI Tile",
    description: "stub",
    allowedRowSizes: ["2-up", "3-up", "4-up"],
    defaultProps: { metricKey: "stub", showDelta: false },
    Render: () => null,
    Inspector: () => null,
  });
});

const empty: ReportState = { title: "Test", pages: [] };

describe("reducer", () => {
  it("ADD_PAGE appends portrait", () => {
    const s = reducer(empty, { type: "ADD_PAGE", orientation: "portrait" });
    expect(s.pages).toHaveLength(1);
    expect(s.pages[0].orientation).toBe("portrait");
    expect(s.pages[0].rows).toEqual([]);
  });

  it("ADD_PAGE inserts after a given page", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const firstId = s.pages[0].id;
    s = reducer(s, { type: "ADD_PAGE", orientation: "landscape", afterPageId: firstId });
    expect(s.pages.map((p) => p.orientation)).toEqual(["portrait", "landscape"]);
  });

  it("DELETE_PAGE removes the matching page", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    s = reducer(s, { type: "DELETE_PAGE", pageId: s.pages[0].id });
    expect(s.pages).toEqual([]);
  });

  it("DELETE_ROW removes the matching row", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const pageId = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "1-up" });
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "2-up" });
    const r0 = s.pages[0].rows[0].id;
    s = reducer(s, { type: "DELETE_ROW", pageId, rowId: r0 });
    expect(s.pages[0].rows).toHaveLength(1);
    expect(s.pages[0].rows[0].layout).toBe("2-up");
  });

  it("REPLACE_WIDGET swaps slot contents to a new kind/id", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const pageId = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "1-up" });
    const rowId = s.pages[0].rows[0].id;
    s = reducer(s, { type: "ADD_WIDGET_TO_SLOT", pageId, rowId, slotIndex: 0, kind: "kpiTile", widgetId: "old" });
    s = reducer(s, { type: "REPLACE_WIDGET", pageId, rowId, slotIndex: 0, kind: "kpiTile", widgetId: "new" });
    expect(s.pages[0].rows[0].slots[0]?.id).toBe("new");
    expect(s.pages[0].rows[0].slots[0]?.kind).toBe("kpiTile");
  });

  it("UPDATE_ROW_LAYOUT bumps overflow widgets to new 1-up rows", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const pageId = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "4-up" });
    const rowId = s.pages[0].rows[0].id;
    // Fill all 4 slots with kpiTile widgets
    for (let i = 0; i < 4; i++) {
      s = reducer(s, {
        type: "ADD_WIDGET_TO_SLOT",
        pageId, rowId, slotIndex: i,
        kind: "kpiTile",
        widgetId: `w${i}`,
      });
    }
    // Shrink to 2-up — slots 2/3 should bump to two new 1-up rows
    s = reducer(s, { type: "UPDATE_ROW_LAYOUT", pageId, rowId, layout: "2-up" });
    expect(s.pages[0].rows).toHaveLength(3);
    expect(s.pages[0].rows[0].layout).toBe("2-up");
    expect(s.pages[0].rows[0].slots.map((w) => w?.id)).toEqual(["w0", "w1"]);
    expect(s.pages[0].rows[1].layout).toBe("1-up");
    expect(s.pages[0].rows[1].slots[0]?.id).toBe("w2");
    expect(s.pages[0].rows[2].slots[0]?.id).toBe("w3");
  });

  it("DUPLICATE_WIDGET fills empty slot in same row", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const pageId = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "2-up" });
    const rowId = s.pages[0].rows[0].id;
    s = reducer(s, { type: "ADD_WIDGET_TO_SLOT", pageId, rowId, slotIndex: 0, kind: "kpiTile", widgetId: "a" });
    s = reducer(s, { type: "DUPLICATE_WIDGET", widgetId: "a", newId: "a-copy" });
    expect(s.pages[0].rows[0].slots[1]?.id).toBe("a-copy");
  });

  it("DUPLICATE_WIDGET overflow creates new 1-up row below", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const pageId = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "1-up" });
    const rowId = s.pages[0].rows[0].id;
    s = reducer(s, { type: "ADD_WIDGET_TO_SLOT", pageId, rowId, slotIndex: 0, kind: "kpiTile", widgetId: "a" });
    s = reducer(s, { type: "DUPLICATE_WIDGET", widgetId: "a", newId: "a-copy" });
    expect(s.pages[0].rows).toHaveLength(2);
    expect(s.pages[0].rows[1].slots[0]?.id).toBe("a-copy");
  });

  it("MOVE_WIDGET removes from source and places at destination", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const pageId = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "1-up" });
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "2-up" });
    const r0 = s.pages[0].rows[0].id;
    const r1 = s.pages[0].rows[1].id;
    s = reducer(s, { type: "ADD_WIDGET_TO_SLOT", pageId, rowId: r0, slotIndex: 0, kind: "kpiTile", widgetId: "w" });
    s = reducer(s, { type: "MOVE_WIDGET", widgetId: "w", toPageId: pageId, toRowId: r1, toSlotIndex: 1 });
    expect(s.pages[0].rows[0].slots[0]).toBeNull();
    expect(s.pages[0].rows[1].slots[1]?.id).toBe("w");
  });

  it("UPDATE_WIDGET_PROPS replaces props by id", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const pageId = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "1-up" });
    const rowId = s.pages[0].rows[0].id;
    s = reducer(s, { type: "ADD_WIDGET_TO_SLOT", pageId, rowId, slotIndex: 0, kind: "kpiTile", widgetId: "w" });
    s = reducer(s, { type: "UPDATE_WIDGET_PROPS", widgetId: "w", props: { metricKey: "netWorthNow", showDelta: true } });
    expect(s.pages[0].rows[0].slots[0]?.props).toEqual({ metricKey: "netWorthNow", showDelta: true });
  });

  it("DELETE_WIDGET nulls the slot", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const pageId = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "1-up" });
    const rowId = s.pages[0].rows[0].id;
    s = reducer(s, { type: "ADD_WIDGET_TO_SLOT", pageId, rowId, slotIndex: 0, kind: "kpiTile", widgetId: "w" });
    s = reducer(s, { type: "DELETE_WIDGET", widgetId: "w" });
    expect(s.pages[0].rows[0].slots[0]).toBeNull();
  });

  it("REORDER_ROWS / REORDER_PAGES move by index", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    s = reducer(s, { type: "ADD_PAGE", orientation: "landscape" });
    s = reducer(s, { type: "REORDER_PAGES", from: 0, to: 1 });
    expect(s.pages.map((p) => p.orientation)).toEqual(["landscape", "portrait"]);

    // Also exercise REORDER_ROWS on a single page.
    const pageId = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "1-up" });
    s = reducer(s, { type: "ADD_ROW", pageId, layout: "2-up" });
    const rowAId = s.pages[0].rows[0].id;
    s = reducer(s, { type: "REORDER_ROWS", pageId, from: 0, to: 1 });
    expect(s.pages[0].rows.map((r) => r.layout)).toEqual(["2-up", "1-up"]);
    expect(s.pages[0].rows[1].id).toBe(rowAId);
  });

  it("TOGGLE_PAGE_ORIENTATION flips", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const id = s.pages[0].id;
    s = reducer(s, { type: "TOGGLE_PAGE_ORIENTATION", pageId: id });
    expect(s.pages[0].orientation).toBe("landscape");
  });

  it("DUPLICATE_PAGE deep-clones with fresh ids", () => {
    let s: ReportState = empty;
    s = reducer(s, { type: "ADD_PAGE", orientation: "portrait" });
    const id = s.pages[0].id;
    s = reducer(s, { type: "ADD_ROW", pageId: id, layout: "1-up" });
    s = reducer(s, { type: "DUPLICATE_PAGE", pageId: id });
    expect(s.pages).toHaveLength(2);
    expect(s.pages[1].id).not.toBe(s.pages[0].id);
    expect(s.pages[1].rows[0].id).not.toBe(s.pages[0].rows[0].id);
  });

  it("SET_TITLE updates title", () => {
    const s = reducer(empty, { type: "SET_TITLE", title: "New title" });
    expect(s.title).toBe("New title");
  });
});
