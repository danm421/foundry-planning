// src/components/reports/widgets/key-indicators-callout.tsx
//
// Screen render for the keyIndicatorsCallout widget. Bordered cream/light
// card matching the polished `advisorCommentary` treatment, with an
// optional Fraunces subsection-styled title and a list of bullet rows
// rendered as `• {text}` lines in body type.
//
// Used in the comparison report's "Where you are today" section to
// surface the most important plan signals (success rate, insurance gaps,
// account-mix concentration, etc.). All bullets are hand-edited; v1 does
// not auto-derive from comparison data.
//
// PDF render lives at `components/reports-pdf/widgets/key-indicators-callout.tsx`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function KeyIndicatorsCalloutRender({
  props,
}: WidgetRenderProps<"keyIndicatorsCallout">) {
  // Drop empty/whitespace-only entries so the inspector can hold a trailing
  // blank line mid-edit without rendering an empty bullet.
  const visible = props.bullets.filter((b) => b.trim().length > 0);
  return (
    <div className="p-4 bg-report-card rounded-md border border-report-hair">
      {props.title && (
        <div className="text-base font-medium text-report-ink mb-2">
          {props.title}
        </div>
      )}
      {visible.length === 0 ? (
        <div className="text-xs text-report-ink-3 italic">
          No indicators yet.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {visible.map((bullet, i) => (
            <li
              key={i}
              className="text-sm text-report-ink leading-relaxed flex items-start gap-2"
            >
              <span className="text-report-ink-2" aria-hidden="true">
                •
              </span>
              <span className="flex-1">{bullet}</span>
            </li>
          ))}
        </ul>
      )}
      {props.notes && (
        <div className="text-xs text-report-ink-3 italic mt-3 whitespace-pre-wrap">
          {props.notes}
        </div>
      )}
    </div>
  );
}
