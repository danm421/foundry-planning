import type { SlotMapping, TemplateLayoutV5 } from "./types";
import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import { isSlotToken } from "./types";

export function resolveSlots(
  layout: TemplateLayoutV5,
  mappings: SlotMapping,
): ComparisonLayoutV5 {
  return {
    ...layout,
    groups: layout.groups.map((g) => ({
      ...g,
      cells: g.cells.map((c) => ({
        ...c,
        widget: c.widget
          ? {
              ...c.widget,
              planIds: c.widget.planIds.map((token) => {
                if (!isSlotToken(token)) return token;
                const mapped = mappings[token];
                if (!mapped) {
                  throw new Error(`missing mapping for slot '${token}'`);
                }
                return mapped;
              }),
            }
          : null,
      })),
    })),
  };
}
