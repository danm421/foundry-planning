import type {
  CellSpan,
  CellV5,
  ComparisonLayoutV4,
  ComparisonLayoutV5,
  Group,
} from "./layout-schema";

const newId = (): string => globalThis.crypto.randomUUID();

function allocateSpans(cellCount: number): CellSpan[] {
  if (cellCount <= 0) return [];
  if (cellCount >= 5) return Array.from({ length: cellCount }, () => 1 as CellSpan);
  const base = Math.floor(5 / cellCount) as CellSpan;
  const remainder = 5 - base * cellCount;
  const out: CellSpan[] = Array.from({ length: cellCount }, () => base);
  out[0] = (base + remainder) as CellSpan;
  return out;
}

export function migrateV4ToV5(v4: ComparisonLayoutV4): ComparisonLayoutV5 {
  const groups: Group[] = v4.rows.map((row) => {
    const spans = allocateSpans(row.cells.length);
    const cells: CellV5[] = row.cells.map((c, i) => ({
      id: c.id,
      span: spans[i],
      widget: c.widget,
    }));
    return { id: newId(), title: "", cells };
  });
  return { version: 5, title: v4.title, groups };
}
