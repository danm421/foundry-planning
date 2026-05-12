"use client";

import type {
  ComparisonLayoutV4,
} from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";

interface Props {
  layout: ComparisonLayoutV4;
  clientId: string;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
}

export function WidgetRenderer({ layout, clientId, plans, mc }: Props) {
  if (layout.rows.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-slate-400">
        No widgets — open the Widget panel to add some.
      </div>
    );
  }

  const planById = new Map(plans.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-2 px-4 py-4">
      {layout.rows.map((row) => (
        <div key={row.id} data-render-row={row.id} className="flex items-stretch gap-2">
          {row.cells.map((cell) => {
            const def = COMPARISON_WIDGETS[cell.widget.kind];
            if (!def) {
              return (
                <div
                  key={cell.id}
                  data-render-cell={cell.id}
                  className="flex-1 min-w-0 rounded border border-dashed border-slate-700 p-4 text-sm text-slate-400"
                >
                  Unknown widget: {cell.widget.kind}
                </div>
              );
            }
            const widgetPlans = cell.widget.planIds
              .map((pid) => planById.get(pid))
              .filter((p): p is ComparisonPlan => p !== undefined);
            return (
              <div
                key={cell.id}
                data-render-cell={cell.id}
                className="flex-1 min-w-0"
              >
                {def.render({
                  instanceId: cell.widget.id,
                  clientId,
                  plans: widgetPlans,
                  mc,
                  config: cell.widget.config,
                  yearRange: cell.widget.yearRange ?? null,
                  editing: false,
                })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
