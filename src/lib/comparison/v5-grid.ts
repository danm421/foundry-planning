import type { CellV5 } from "./layout-schema";

export const MAX_SPAN_PER_ROW = 5;

export function computeVisualRows(cells: readonly CellV5[]): CellV5[][] {
  const rows: CellV5[][] = [];
  let current: CellV5[] = [];
  let sum = 0;
  for (const c of cells) {
    if (sum + c.span > MAX_SPAN_PER_ROW) {
      if (current.length > 0) rows.push(current);
      current = [c];
      sum = c.span;
    } else {
      current.push(c);
      sum += c.span;
    }
  }
  if (current.length > 0) rows.push(current);
  return rows;
}

export function findEndOfVisualRowIndex(cells: readonly CellV5[], fromIndex: number): number {
  if (fromIndex < 0 || fromIndex >= cells.length) return cells.length;
  let sum = 0;
  for (let i = 0; i < cells.length; i += 1) {
    if (sum + cells[i].span > MAX_SPAN_PER_ROW) {
      // Cell `i` starts a new row.
      if (fromIndex < i) return i;
      sum = cells[i].span;
    } else {
      sum += cells[i].span;
    }
  }
  // fromIndex is in the final row.
  return cells.length;
}
