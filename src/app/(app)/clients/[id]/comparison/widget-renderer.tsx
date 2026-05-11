"use client";

import type { ComparisonLayout, YearRange } from "@/lib/comparison/layout-schema";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { McSharedResult } from "@/lib/comparison/widgets/types";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";

interface Props {
  layout: ComparisonLayout;
  clientId: string;
  plans: ComparisonPlan[];
  mc: McSharedResult | null;
  yearRange: YearRange | null;
  editing: boolean;
  onTextChange?: (instanceId: string, markdown: string) => void;
}

export function WidgetRenderer({
  layout,
  clientId,
  plans,
  mc,
  yearRange,
  editing,
  onTextChange,
}: Props) {
  if (layout.items.length === 0) {
    return (
      <div className="px-6 py-16 text-center text-slate-400">
        No widgets — open the Widget panel to add some.
      </div>
    );
  }
  return (
    <>
      {layout.items.map((item) => {
        const def = COMPARISON_WIDGETS[item.kind];
        return (
          <div key={item.instanceId} data-widget-instance={item.instanceId}>
            {def.render({
              instanceId: item.instanceId,
              clientId,
              plans,
              mc,
              config: item.config,
              yearRange,
              editing,
              onTextChange,
            })}
          </div>
        );
      })}
    </>
  );
}
