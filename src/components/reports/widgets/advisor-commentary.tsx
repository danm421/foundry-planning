// src/components/reports/widgets/advisor-commentary.tsx
//
// Screen render for the advisorCommentary widget. Optional Fraunces
// subsection-styled headline + body paragraph + optional muted notes.
// Body honors newlines via `whitespace-pre-wrap` so advisors can write
// multi-paragraph commentary without needing markdown.
//
// Visual treatment matches the Ethos comparison redesign narrative
// pattern: cream/light bordered card, subsection-styled headline (Fraunces
// 14pt), body in body role (Inter 10pt / `text-sm`), notes muted at the
// bottom (Inter 9pt / `text-xs`, italic). Matches `aiAnalysis` exactly so
// they read as a single narrative widget pattern.
//
// PDF render lives at `components/reports-pdf/widgets/advisor-commentary.tsx`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function AdvisorCommentaryRender({
  props,
}: WidgetRenderProps<"advisorCommentary">) {
  return (
    <div className="p-4 bg-report-card rounded-md border border-report-hair">
      {props.headline && (
        <div className="text-base font-medium text-report-ink mb-2">
          {props.headline}
        </div>
      )}
      <div className="text-sm text-report-ink whitespace-pre-wrap leading-relaxed">
        {props.body}
      </div>
      {props.notes && (
        <div className="text-xs text-report-ink-3 italic mt-3 whitespace-pre-wrap">
          {props.notes}
        </div>
      )}
    </div>
  );
}
