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
  // Walk backwards to find the start of fromIndex's visual row.
  let rowStart = fromIndex;
  let sum = cells[fromIndex].span;
  while (rowStart > 0) {
    const prevSum = sum + cells[rowStart - 1].span;
    if (prevSum > MAX_SPAN_PER_ROW) break;
    sum = prevSum;
    rowStart -= 1;
  }
  // Walk forwards from rowStart, accumulating until we'd overflow.
  let i = rowStart;
  let acc = 0;
  while (i < cells.length) {
    if (acc + cells[i].span > MAX_SPAN_PER_ROW) break;
    acc += cells[i].span;
    i += 1;
  }
  return i;
}
