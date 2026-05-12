import type { ComparisonLayoutV5, YearRange, ComparisonWidgetKindV4 } from "./layout-schema";

export interface ResolvedSource {
  cellId: string;
  groupId: string;
  groupTitle: string;
  widgetKind: ComparisonWidgetKindV4;
  planIds: string[];
  yearRange: YearRange | undefined;
}

export interface AiSourceSelection {
  groupIds: string[];
  cellIds: string[];
}

export function resolveAiSources(
  layout: ComparisonLayoutV5,
  selection: AiSourceSelection,
  selfCellId: string,
): ResolvedSource[] {
  const wantedGroup = new Set(selection.groupIds);
  const wantedCell = new Set(selection.cellIds);
  const out: ResolvedSource[] = [];
  const seen = new Set<string>();

  for (const g of layout.groups) {
    const groupHit = wantedGroup.has(g.id);
    for (const c of g.cells) {
      if (!c.widget) continue;
      if (c.id === selfCellId) continue;
      if (seen.has(c.id)) continue;
      const cellHit = wantedCell.has(c.id);
      if (!groupHit && !cellHit) continue;
      seen.add(c.id);
      out.push({
        cellId: c.id,
        groupId: g.id,
        groupTitle: g.title,
        widgetKind: c.widget.kind,
        planIds: [...c.widget.planIds],
        yearRange: c.widget.yearRange,
      });
    }
  }

  return out;
}
