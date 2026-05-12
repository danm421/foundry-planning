// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayout } from "../use-layout";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";

const blank: ComparisonLayoutV5 = {
  version: 5,
  title: "T",
  groups: [{ id: "g1", title: "", cells: [{ id: "c1", span: 5, widget: null }] }],
};

describe("useLayout v5", () => {
  it("addGroup appends an empty group with one span-5 cell", () => {
    const { result } = renderHook(() => useLayout(blank, "client-1"));
    act(() => result.current.addGroup());
    expect(result.current.layout.groups).toHaveLength(2);
    expect(result.current.layout.groups[1].title).toBe("Group Name");
    expect(result.current.layout.groups[1].cells).toHaveLength(1);
    expect(result.current.layout.groups[1].cells[0].span).toBe(5);
    expect(result.current.layout.groups[1].cells[0].widget).toBeNull();
  });

  it("addEmptyCellRight inserts a span-1 empty cell after the source", () => {
    const { result } = renderHook(() => useLayout(blank, "client-1"));
    act(() => result.current.addEmptyCellRight("g1", "c1"));
    const cells = result.current.layout.groups[0].cells;
    expect(cells).toHaveLength(2);
    expect(cells[1].span).toBe(1);
    expect(cells[1].widget).toBeNull();
  });

  it("addEmptyCellDown inserts a span-5 cell at the end of the source's visual row", () => {
    const initial: ComparisonLayoutV5 = {
      version: 5,
      title: "T",
      groups: [
        {
          id: "g1",
          title: "",
          cells: [
            { id: "a", span: 3, widget: null },
            { id: "b", span: 2, widget: null },
            { id: "c", span: 5, widget: null },
          ],
        },
      ],
    };
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.addEmptyCellDown("g1", "a"));
    const cells = result.current.layout.groups[0].cells;
    expect(cells.map((c) => c.id)).toEqual(["a", "b", expect.any(String), "c"]);
    const inserted = cells[2];
    expect(inserted.span).toBe(5);
    expect(inserted.widget).toBeNull();
  });

  it("removeCell on populated cell replaces with empty placeholder, preserving span", () => {
    const initial: ComparisonLayoutV5 = {
      version: 5,
      title: "T",
      groups: [
        {
          id: "g",
          title: "",
          cells: [
            { id: "c", span: 3, widget: { id: "w", kind: "portfolio", planIds: ["base"] } },
          ],
        },
      ],
    };
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.removeCell("g", "c"));
    expect(result.current.layout.groups[0].cells[0].widget).toBeNull();
    expect(result.current.layout.groups[0].cells[0].span).toBe(3);
  });

  it("removeCell on empty cell deletes it", () => {
    const initial: ComparisonLayoutV5 = {
      version: 5,
      title: "T",
      groups: [
        {
          id: "g",
          title: "",
          cells: [
            { id: "c1", span: 2, widget: null },
            { id: "c2", span: 3, widget: null },
          ],
        },
      ],
    };
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.removeCell("g", "c1"));
    expect(result.current.layout.groups[0].cells.map((c) => c.id)).toEqual(["c2"]);
  });

  it("setCellSpan changes a cell's span", () => {
    const { result } = renderHook(() => useLayout(blank, "client-1"));
    act(() => result.current.setCellSpan("c1", 3));
    expect(result.current.layout.groups[0].cells[0].span).toBe(3);
  });

  it("setCellWidget populates an empty cell with the given widget", () => {
    const { result } = renderHook(() => useLayout(blank, "client-1"));
    act(() =>
      result.current.setCellWidget("c1", {
        id: "w-new",
        kind: "portfolio",
        planIds: ["base"],
      }),
    );
    expect(result.current.layout.groups[0].cells[0].widget?.kind).toBe("portfolio");
    expect(result.current.layout.groups[0].cells[0].widget?.id).toBe("w-new");
  });

  it("setGroupTitle updates a group's title", () => {
    const { result } = renderHook(() => useLayout(blank, "client-1"));
    act(() => result.current.setGroupTitle("g1", "Summary"));
    expect(result.current.layout.groups[0].title).toBe("Summary");
  });

  it("removeGroup deletes the group", () => {
    const two: ComparisonLayoutV5 = {
      version: 5,
      title: "T",
      groups: [
        { id: "g1", title: "", cells: [{ id: "c1", span: 5, widget: null }] },
        { id: "g2", title: "", cells: [{ id: "c2", span: 5, widget: null }] },
      ],
    };
    const { result } = renderHook(() => useLayout(two, "client-1"));
    act(() => result.current.removeGroup("g1"));
    expect(result.current.layout.groups.map((g) => g.id)).toEqual(["g2"]);
  });

  it("duplicateCell clones a populated cell after the source with same span", () => {
    const initial: ComparisonLayoutV5 = {
      version: 5,
      title: "T",
      groups: [
        {
          id: "g",
          title: "",
          cells: [
            { id: "c", span: 2, widget: { id: "w", kind: "portfolio", planIds: ["base"] } },
          ],
        },
      ],
    };
    const { result } = renderHook(() => useLayout(initial, "client-1"));
    act(() => result.current.duplicateCell("g", "c"));
    const cells = result.current.layout.groups[0].cells;
    expect(cells).toHaveLength(2);
    expect(cells[1].span).toBe(2);
    expect(cells[1].widget?.kind).toBe("portfolio");
    expect(cells[1].widget?.id).not.toBe("w");
  });

  it("moveCell across groups moves the cell and removes the source group if empty", () => {
    const two: ComparisonLayoutV5 = {
      version: 5,
      title: "T",
      groups: [
        { id: "g1", title: "", cells: [{ id: "c1", span: 5, widget: null }] },
        { id: "g2", title: "", cells: [{ id: "c2", span: 5, widget: null }] },
      ],
    };
    const { result } = renderHook(() => useLayout(two, "client-1"));
    act(() => result.current.moveCell("g1", 0, "g2", 1));
    expect(result.current.layout.groups).toHaveLength(1);
    expect(result.current.layout.groups[0].id).toBe("g2");
    expect(result.current.layout.groups[0].cells.map((c) => c.id)).toEqual(["c2", "c1"]);
  });
});
