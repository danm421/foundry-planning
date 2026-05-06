// src/components/reports/widgets/action-items-list.tsx
//
// Screen render for the actionItemsList widget. Subsection-styled title
// with a 1.5px accent underline above a flat list of priority-tagged
// items. Each item: `[HIGH]` / `[MED]` / `[LOW]` priority chip in mono
// uppercase, the action text, and an optional `(timeframe)` suffix
// rendered in muted ink.
//
// Priority colors via REPORT_THEME tokens — high=crit, medium=accent,
// low=ink-3. Not a card — renders flat to fit alongside other narrative
// blocks on the same page.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { RiskSeverity } from "@/lib/reports/types";

type Priority = "high" | "medium" | "low";

const PRIORITY_LABEL: Record<Priority, string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

const PRIORITY_CLASS: Record<Priority, string> = {
  high: "text-report-crit",
  medium: "text-report-accent",
  low: "text-report-ink-3",
};

// `RiskSeverity` ⊃ Priority by spec — ensure the maps stay aligned if
// types.ts ever widens the union.
const _typecheck: Record<Priority, RiskSeverity> = {
  high: "high",
  medium: "medium",
  low: "low",
};
void _typecheck;

export function ActionItemsListRender({
  props,
}: WidgetRenderProps<"actionItemsList">) {
  const items = props.items ?? [];
  return (
    <div>
      {props.title && (
        <div className="pb-2 mb-3 border-b border-report-accent">
          <div className="text-base font-medium text-report-ink">
            {props.title}
          </div>
        </div>
      )}
      {items.length === 0 ? (
        <div className="text-xs text-report-ink-3 italic">
          No action items — add items in the inspector.
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((it, i) => (
            <li
              key={i}
              className="flex items-baseline gap-2 text-sm text-report-ink leading-relaxed"
            >
              <span
                className={`text-[10px] font-mono font-medium tracking-wider shrink-0 ${PRIORITY_CLASS[it.priority]}`}
              >
                [{PRIORITY_LABEL[it.priority]}]
              </span>
              <span>
                {it.text}
                {it.timeframe && (
                  <span className="text-report-ink-3 italic ml-1">
                    ({it.timeframe})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
