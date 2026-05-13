"use client";

import type { ComparisonLayoutV5 } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McRunView, McSharedResult } from "@/lib/comparison/widgets/types";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";

const SPAN_TO_CLASS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "col-span-1",
  2: "col-span-2",
  3: "col-span-3",
  4: "col-span-4",
  5: "col-span-5",
};

interface Props {
  layout: ComparisonLayoutV5;
  clientId: string;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  mcRun: McRunView;
  onExpandTextCell?: (cellId: string, mode: "edit" | "view") => void;
}

export function WidgetRenderer({ layout, clientId, plans, mc, mcRun, onExpandTextCell }: Props) {
  if (layout.groups.length === 0) {
    return <div className="px-6 py-16 text-center text-slate-400">No widgets yet.</div>;
  }

  const planById = new Map(plans.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-6 px-4 py-4">
      {layout.groups.map((group) => (
        <section key={group.id} data-render-group={group.id} className="flex flex-col gap-2">
          {group.title.trim() !== "" && (
            <h2 className="text-base font-semibold text-slate-100">{group.title}</h2>
          )}
          <div className="grid grid-cols-5 gap-2">
            {group.cells.map((cell) => {
              if (!cell.widget) return null;
              const def = COMPARISON_WIDGETS[cell.widget.kind];
              if (!def) {
                return (
                  <div
                    key={cell.id}
                    data-render-cell={cell.id}
                    className={`${SPAN_TO_CLASS[cell.span]} min-w-0 rounded border border-dashed border-slate-700 p-4 text-sm text-slate-400`}
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
                  className={`${SPAN_TO_CLASS[cell.span]} min-w-0`}
                >
                  {def.render({
                    instanceId: cell.widget.id,
                    cellId: cell.id,
                    clientId,
                    plans: widgetPlans,
                    mc,
                    mcRun,
                    config: cell.widget.config,
                    yearRange: cell.widget.yearRange ?? null,
                    editing: false,
                    onExpand: onExpandTextCell,
                  })}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
