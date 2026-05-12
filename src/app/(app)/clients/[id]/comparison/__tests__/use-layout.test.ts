// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLayout } from "../use-layout";
import type { ComparisonLayoutV4 } from "@/lib/comparison/layout-schema";

const initial: ComparisonLayoutV4 = {
  version: 4,
  title: "Test",
  rows: [
    {
      id: "row-a",
      cells: [
        {
          id: "cell-a1",
          widget: { id: "w-a1", kind: "portfolio", planIds: ["base"] },
        },
      ],
    },
    {
      id: "row-b",
      cells: [
        {
          id: "cell-b1",
          widget: { id: "w-b1", kind: "monte-carlo", planIds: ["base"] },
        },
        {
          id: "cell-b2",
          widget: { id: "w-b2", kind: "longevity", planIds: ["base"] },
        },
      ],
    },
  ],
};

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as never;
});

describe("useLayout (v4)", () => {
  it("setTitle updates the title", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.setTitle("Renamed"));
    expect(result.current.layout.title).toBe("Renamed");
  });

  it("addRow appends an empty-but-valid placeholder row and returns its ids", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    let rowId = "";
    let placeholderCellId = "";
    act(() => {
      ({ rowId, placeholderCellId } = result.current.addRow());
    });
    expect(result.current.layout.rows.at(-1)?.id).toBe(rowId);
    // New row starts with a single text cell so it satisfies min-1-cell validation.
    expect(result.current.layout.rows.at(-1)?.cells).toHaveLength(1);
    expect(result.current.layout.rows.at(-1)?.cells[0].widget.kind).toBe("text");
    expect(result.current.layout.rows.at(-1)?.cells[0].id).toBe(placeholderCellId);
  });

  it("removeRow drops the row by id", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.removeRow("row-a"));
    expect(result.current.layout.rows.map((r) => r.id)).toEqual(["row-b"]);
  });

  it("moveRow reorders rows by index", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.moveRow(1, 0));
    expect(result.current.layout.rows.map((r) => r.id)).toEqual(["row-b", "row-a"]);
  });

  it("addCell appends a cell to the row with the given kind", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.addCell("row-a", "estate-tax"));
    expect(result.current.layout.rows[0].cells).toHaveLength(2);
    expect(result.current.layout.rows[0].cells[1].widget.kind).toBe("estate-tax");
  });

  it("addCell refuses to exceed 5 cells in a row", () => {
    const sixthRow: ComparisonLayoutV4 = {
      ...initial,
      rows: [
        {
          id: "row-x",
          cells: Array.from({ length: 5 }, (_, i) => ({
            id: `cell-x${i}`,
            widget: { id: `w-x${i}`, kind: "kpi" as const, planIds: ["base"] },
          })),
        },
      ],
    };
    const { result } = renderHook(() => useLayout(sixthRow, "c"));
    act(() => result.current.addCell("row-x", "portfolio"));
    expect(result.current.layout.rows[0].cells).toHaveLength(5);
  });

  it("removeCell drops the cell; removing the last cell of a row removes the row", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.removeCell("row-b", "cell-b2"));
    expect(result.current.layout.rows[1].cells.map((c) => c.id)).toEqual(["cell-b1"]);

    act(() => result.current.removeCell("row-b", "cell-b1"));
    expect(result.current.layout.rows.map((r) => r.id)).toEqual(["row-a"]);
  });

  it("moveCell within a row reorders the cells", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.moveCell("row-b", 0, "row-b", 1));
    expect(result.current.layout.rows[1].cells.map((c) => c.id)).toEqual([
      "cell-b2", "cell-b1",
    ]);
  });

  it("moveCell across rows moves the cell to the new row's index", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.moveCell("row-b", 1, "row-a", 1));
    expect(result.current.layout.rows[0].cells.map((c) => c.id)).toEqual([
      "cell-a1", "cell-b2",
    ]);
    expect(result.current.layout.rows[1].cells.map((c) => c.id)).toEqual(["cell-b1"]);
  });

  it("updateWidgetPlanIds replaces planIds on the targeted cell", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.updateWidgetPlanIds("cell-a1", ["base", "sc-1"]));
    expect(result.current.layout.rows[0].cells[0].widget.planIds).toEqual(["base", "sc-1"]);
  });

  it("updateWidgetYearRange sets and clears the cell's yearRange", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.updateWidgetYearRange("cell-a1", { start: 2030, end: 2055 }));
    expect(result.current.layout.rows[0].cells[0].widget.yearRange).toEqual({
      start: 2030, end: 2055,
    });
    act(() => result.current.updateWidgetYearRange("cell-a1", undefined));
    expect(result.current.layout.rows[0].cells[0].widget.yearRange).toBeUndefined();
  });

  it("updateWidgetConfig replaces config on the targeted cell", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.updateWidgetConfig("cell-a1", { stackBy: "source" }));
    expect(result.current.layout.rows[0].cells[0].widget.config).toEqual({ stackBy: "source" });
  });

  it("updateTextMarkdown writes config.markdown on a text cell", () => {
    const text: ComparisonLayoutV4 = {
      version: 4,
      title: "T",
      rows: [
        {
          id: "row-t",
          cells: [
            {
              id: "cell-t",
              widget: { id: "w-t", kind: "text", planIds: [], config: { markdown: "" } },
            },
          ],
        },
      ],
    };
    const { result } = renderHook(() => useLayout(text, "c"));
    act(() => result.current.updateTextMarkdown("cell-t", "Hello"));
    expect(result.current.layout.rows[0].cells[0].widget.config).toEqual({ markdown: "Hello" });
  });

  it("reset replaces the layout with the v4 default for the given primary", () => {
    const { result } = renderHook(() => useLayout(initial, "c"));
    act(() => result.current.reset("base"));
    expect(result.current.layout.rows).toHaveLength(5);
    expect(result.current.layout.rows[0].cells).toHaveLength(5);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("save() PUTs the current layout and surfaces errors", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ layout: initial }) });
    const { result } = renderHook(() => useLayout(initial, "c"));
    await act(async () => {
      await result.current.save();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sentBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sentBody.version).toBe(4);

    fetchMock.mockResolvedValue({ ok: false, status: 422, json: async () => ({ errors: ["x"] }) });
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.save();
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).toBeInstanceOf(Error);
  });

  it("save() drops whitespace-only text cells (and prunes now-empty rows)", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ layout: initial }) });
    const onlyText: ComparisonLayoutV4 = {
      version: 4,
      title: "T",
      rows: [
        {
          id: "row-t",
          cells: [
            {
              id: "cell-t",
              widget: { id: "w-t", kind: "text", planIds: [], config: { markdown: "   " } },
            },
          ],
        },
      ],
    };
    const { result } = renderHook(() => useLayout(onlyText, "c"));
    await act(async () => {
      await result.current.save();
    });
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.rows).toHaveLength(0);
  });
});
