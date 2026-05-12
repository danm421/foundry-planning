import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import type { TemplateLayoutV5 } from "./types";
import { SLOT_TOKENS } from "./types";

export interface ExtractResult {
  layout: TemplateLayoutV5;
  slotLabels: string[];
  planIdBySlot: Record<string, string>;
}

export function extractSlots(
  layout: ComparisonLayoutV5,
  nameByPlanId: Record<string, string>,
): ExtractResult {
  const order: string[] = [];
  for (const g of layout.groups) {
    for (const c of g.cells) {
      if (!c.widget) continue;
      for (const pid of c.widget.planIds) {
        if (!order.includes(pid)) order.push(pid);
      }
    }
  }
  if (order.length > SLOT_TOKENS.length) {
    throw new Error(
      `comparison references ${order.length} plans; templates support at most 8 unique plans`,
    );
  }

  const slotByPlan = new Map<string, string>(
    order.map((pid, i) => [pid, SLOT_TOKENS[i]]),
  );
  const planIdBySlot: Record<string, string> = {};
  for (const [pid, slot] of slotByPlan) planIdBySlot[slot] = pid;

  const slotLabels = order.map((pid, i) => nameByPlanId[pid] ?? `Plan ${SLOT_TOKENS[i]}`);

  const newLayout: TemplateLayoutV5 = {
    ...layout,
    groups: layout.groups.map((g) => ({
      ...g,
      cells: g.cells.map((c) => ({
        ...c,
        widget: c.widget
          ? {
              ...c.widget,
              planIds: c.widget.planIds.map((pid) => slotByPlan.get(pid)!),
            }
          : null,
      })),
    })),
  };

  return { layout: newLayout, slotLabels, planIdBySlot };
}
