// src/components/reports/widgets/disclaimer-block.tsx
//
// Screen render for the disclaimerBlock widget. 1.5px solid accent rule
// across the top, then padded small-print body text in muted italic.
// Honors line breaks via `whitespace-pre-wrap` so multi-paragraph
// disclaimers (rare but legal sometimes adds them) render naturally.
//
// PDF render lives at `components/reports-pdf/widgets/disclaimer-block.tsx`.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function DisclaimerBlockRender({
  props,
}: WidgetRenderProps<"disclaimerBlock">) {
  return (
    <div style={{ borderTop: "1.5px solid var(--color-report-accent)" }}>
      <div className="pt-3 text-report-ink-3 text-xs italic whitespace-pre-wrap leading-relaxed">
        {props.body}
      </div>
    </div>
  );
}
