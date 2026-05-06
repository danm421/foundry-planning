// src/components/reports/widgets/section-head.tsx
//
// Screen render for the sectionHead widget. Eyebrow + big serif title,
// separated from preceding content by a hairline rule. Pure structural
// chrome — no engine data.
//
// PDF render lives at `components/reports-pdf/widgets/section-head.tsx`
// and is wired onto the registry entry by
// `lib/reports/widgets/section-head.pdf.ts`, server-only.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function SectionHeadRender({ props }: WidgetRenderProps<"sectionHead">) {
  return (
    <div className="border-t border-hair pt-6">
      <div className="text-[11px] font-mono text-accent mb-2">{props.eyebrow}</div>
      <div className="text-[28px] font-serif text-ink">{props.title}</div>
    </div>
  );
}
