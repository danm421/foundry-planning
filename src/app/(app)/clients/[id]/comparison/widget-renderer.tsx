"use client";

import type { ComparisonLayout } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";

interface Props {
  layout: ComparisonLayout;
  clientId: string;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
}

export function WidgetRenderer({ layout, clientId, plans, mc }: Props) {
  const visible = layout.items.filter((i) => !i.hidden);
  if (visible.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-slate-400">
        No widgets visible — open Customize to add some.
      </div>
    );
  }
  return (
    <>
      {visible.map((item) => {
        const def = COMPARISON_WIDGETS[item.kind];
        return (
          <div key={item.instanceId} data-widget-instance={item.instanceId}>
            {def.render({
              clientId,
              plans,
              mc,
              collapsed: item.collapsed,
              config: item.config,
            })}
          </div>
        );
      })}
    </>
  );
}
