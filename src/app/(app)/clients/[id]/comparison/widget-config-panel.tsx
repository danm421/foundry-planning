"use client";

import type { WidgetInstance, YearRange } from "@/lib/comparison/layout-schema";
import { COMPARISON_WIDGETS } from "@/lib/comparison/widgets/registry";
import { ScenarioChipPicker } from "./scenario-chip-picker";
import { PerWidgetYearRange } from "./per-widget-year-range";

interface Props {
  widget: WidgetInstance;
  scenarios: { id: string; name: string }[];
  availableYearRange: { min: number; max: number };
  onChangePlanIds: (planIds: string[]) => void;
  onChangeYearRange: (yearRange: YearRange | undefined) => void;
  onChangeConfig: (config: unknown) => void;
}

export function WidgetConfigPanel({
  widget,
  scenarios,
  availableYearRange,
  onChangePlanIds,
  onChangeYearRange,
  onChangeConfig,
}: Props) {
  const def = COMPARISON_WIDGETS[widget.kind];
  return (
    <div className="flex flex-col gap-3 rounded border border-slate-800 bg-slate-950/60 p-3 text-xs">
      {def.scenarios !== "none" && (
        <section>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Scenarios
          </div>
          <ScenarioChipPicker
            cardinality={def.scenarios}
            scenarios={scenarios}
            planIds={widget.planIds}
            onChange={onChangePlanIds}
          />
        </section>
      )}

      {def.scenarios !== "none" && (
        <section>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Year range
          </div>
          <PerWidgetYearRange
            min={availableYearRange.min}
            max={availableYearRange.max}
            yearRange={widget.yearRange}
            onChange={onChangeYearRange}
          />
        </section>
      )}

      {def.renderConfig && (
        <section>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Options
          </div>
          {def.renderConfig({ config: widget.config, onChange: onChangeConfig })}
        </section>
      )}
    </div>
  );
}
