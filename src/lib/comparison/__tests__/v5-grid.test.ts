import { describe, it, expect } from "vitest";
import { computeVisualRows, findEndOfVisualRowIndex, MAX_SPAN_PER_ROW } from "../v5-grid";
import type { CellV5 } from "../layout-schema";

const cell = (id: string, span: CellV5["span"]): CellV5 => ({ id, span, widget: null });

describe("v5-grid helpers", () => {
  it("MAX_SPAN_PER_ROW is 5", () => {
    expect(MAX_SPAN_PER_ROW).toBe(5);
  });

  it("computeVisualRows groups cells into rows whose span-sum is ≤ 5", () => {
    const cells = [cell("a", 3), cell("b", 2), cell("c", 4), cell("d", 1)];
    expect(computeVisualRows(cells)).toEqual([
      [cell("a", 3), cell("b", 2)],
      [cell("c", 4), cell("d", 1)],
    ]);
  });

  it("a span-5 cell occupies a row by itself", () => {
    const cells = [cell("a", 5), cell("b", 2), cell("c", 3)];
    expect(computeVisualRows(cells)).toEqual([
      [cell("a", 5)],
      [cell("b", 2), cell("c", 3)],
    ]);
  });

  it("wraps when the next cell would overflow", () => {
    const cells = [cell("a", 3), cell("b", 3)];
    expect(computeVisualRows(cells)).toEqual([[cell("a", 3)], [cell("b", 3)]]);
  });

  it("returns [] for empty input", () => {
    expect(computeVisualRows([])).toEqual([]);
  });

  it("findEndOfVisualRowIndex returns the index just past the visual row containing the given index", () => {
    const cells = [cell("a", 3), cell("b", 2), cell("c", 4), cell("d", 1)];
    expect(findEndOfVisualRowIndex(cells, 0)).toBe(2); // row [a,b] ends after index 1
    expect(findEndOfVisualRowIndex(cells, 1)).toBe(2);
    expect(findEndOfVisualRowIndex(cells, 2)).toBe(4); // row [c,d] ends after index 3
    expect(findEndOfVisualRowIndex(cells, 3)).toBe(4);
  });

  it("findEndOfVisualRowIndex returns cells.length when fromIndex is on the last row", () => {
    const cells = [cell("a", 5)];
    expect(findEndOfVisualRowIndex(cells, 0)).toBe(1);
  });

  it("findEndOfVisualRowIndex handles two tightly-packed adjacent rows", () => {
    const cells = [cell("a", 3), cell("b", 2), cell("c", 3), cell("d", 2)];
    // Rows: [a,b] | [c,d]
    expect(findEndOfVisualRowIndex(cells, 0)).toBe(2);
    expect(findEndOfVisualRowIndex(cells, 1)).toBe(2);
    expect(findEndOfVisualRowIndex(cells, 2)).toBe(4);
    expect(findEndOfVisualRowIndex(cells, 3)).toBe(4);
  });
});
