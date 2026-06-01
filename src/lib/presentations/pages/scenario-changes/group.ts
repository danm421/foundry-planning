import type { ScenarioChange, ToggleGroup } from "@/engine/scenario/types";
import type { ChangeRow, DisplayUnit } from "./types";
import { AREA_ORDER } from "./describe/specs";

export interface DescribedChange {
  change: ScenarioChange;
  row: ChangeRow;
}

function areaRank(row: ChangeRow): number {
  const i = AREA_ORDER.indexOf(row.area);
  return i === -1 ? AREA_ORDER.length : i;
}

/** Sort key for a unit: smallest area rank among its rows, then smallest orderIndex. */
function unitSortKey(rows: ChangeRow[], orderIndices: number[]): [number, number] {
  return [Math.min(...rows.map(areaRank)), Math.min(...orderIndices)];
}

export function groupUnits(items: DescribedChange[], toggleGroups: ToggleGroup[]): DisplayUnit[] {
  const groupName = new Map(toggleGroups.map((g) => [g.id, g.name]));

  const grouped = new Map<string, DescribedChange[]>();
  const singles: DescribedChange[] = [];
  for (const it of items) {
    const gid = it.change.toggleGroupId;
    if (gid) {
      const arr = grouped.get(gid) ?? [];
      arr.push(it);
      grouped.set(gid, arr);
    } else {
      singles.push(it);
    }
  }

  type Entry = { unit: DisplayUnit; key: [number, number] };
  const entries: Entry[] = [];

  for (const s of singles) {
    entries.push({ unit: { kind: "row", row: s.row }, key: unitSortKey([s.row], [s.change.orderIndex]) });
  }
  for (const [gid, members] of grouped) {
    const sorted = [...members].sort((a, b) => a.change.orderIndex - b.change.orderIndex);
    const rows = sorted.map((m) => m.row);
    entries.push({
      unit: { kind: "group", label: groupName.get(gid) ?? "Strategy", rows },
      key: unitSortKey(rows, sorted.map((m) => m.change.orderIndex)),
    });
  }

  entries.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1]);
  return entries.map((e) => e.unit);
}
