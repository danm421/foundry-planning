// src/components/reports/widgets/status-callout.tsx
//
// Screen render for the statusCallout widget. Rounded card with a 3px
// colored left border, a tinted background, a 1px hair border on the
// other three sides, a leading status glyph (✓ / ⚠ / !), an optional
// colored headline, and a body line.
//
// Status → palette mapping (all colors via `report-*` design tokens; no
// inlined hex):
//
//   "go"   → border + headline `report-good`,    background `report-good-tint`,   ✓
//   "warn" → border + headline `report-accent`,  background `report-accent-tint`, ⚠
//   "risk" → border + headline `report-crit`,    background `report-crit-tint`,   !
//
// Used wherever the report needs a status callout — estate plan
// completeness, insurance coverage gaps, success-rate banding, etc.
//
// PDF render lives at `components/reports-pdf/widgets/status-callout.tsx`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { StatusCalloutProps } from "@/lib/reports/types";

type Status = StatusCalloutProps["status"];

const STATUS_STYLES: Record<
  Status,
  {
    /** Tailwind utility class for the tinted background. */
    bgClass: string;
    /** Tailwind utility class for the headline + accent ink. */
    inkClass: string;
    /** CSS variable consumed by the inline `borderLeft` style. */
    borderVar: string;
    /** Glyph rendered before the headline. */
    glyph: string;
  }
> = {
  go: {
    bgClass: "bg-report-good-tint",
    inkClass: "text-report-good",
    borderVar: "var(--color-report-good)",
    glyph: "✓",
  },
  warn: {
    bgClass: "bg-report-accent-tint",
    inkClass: "text-report-accent",
    borderVar: "var(--color-report-accent)",
    glyph: "⚠",
  },
  risk: {
    bgClass: "bg-report-crit-tint",
    inkClass: "text-report-crit",
    borderVar: "var(--color-report-crit)",
    glyph: "!",
  },
};

export function StatusCalloutRender({
  props,
}: WidgetRenderProps<"statusCallout">) {
  const style = STATUS_STYLES[props.status];
  return (
    <div
      className={`${style.bgClass} rounded-md border border-report-hair p-4 flex items-start gap-3`}
      style={{ borderLeft: `3px solid ${style.borderVar}` }}
      role="note"
    >
      <div
        className={`${style.inkClass} text-base font-medium leading-none mt-[2px]`}
        aria-hidden="true"
      >
        {style.glyph}
      </div>
      <div className="flex-1 min-w-0">
        {props.headline && (
          <div className={`${style.inkClass} text-base font-medium`}>
            {props.headline}
          </div>
        )}
        <div className="text-sm text-report-ink whitespace-pre-wrap leading-relaxed">
          {props.body}
        </div>
        {props.notes && (
          <div className="text-xs text-report-ink-3 italic mt-2 whitespace-pre-wrap">
            {props.notes}
          </div>
        )}
      </div>
    </div>
  );
}
