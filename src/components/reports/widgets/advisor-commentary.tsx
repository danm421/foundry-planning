// src/components/reports/widgets/advisor-commentary.tsx
//
// Screen render for the advisorCommentary widget. Optional uppercase
// mono headline + body paragraph. Body honors newlines via
// `whitespace-pre-wrap` so advisors can write multi-paragraph commentary
// without needing markdown.
//
// PDF render lives at `components/reports-pdf/widgets/advisor-commentary.tsx`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function AdvisorCommentaryRender({
  props,
}: WidgetRenderProps<"advisorCommentary">) {
  return (
    <div className="p-5 bg-card-2 rounded-md border border-hair">
      {props.headline && (
        <div className="text-[11px] font-mono text-accent mb-2 uppercase">
          {props.headline}
        </div>
      )}
      <div className="text-[14px] text-ink whitespace-pre-wrap leading-relaxed">
        {props.body}
      </div>
    </div>
  );
}
