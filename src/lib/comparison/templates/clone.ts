import type { TemplateLayoutV5 } from "./types";

export function cloneComparisonTemplate(layout: TemplateLayoutV5): TemplateLayoutV5 {
  return {
    ...layout,
    groups: layout.groups.map((g) => ({
      ...g,
      id: crypto.randomUUID(),
      cells: g.cells.map((c) => ({
        ...c,
        id: crypto.randomUUID(),
        widget: c.widget ? { ...c.widget, id: crypto.randomUUID() } : null,
      })),
    })),
  };
}
