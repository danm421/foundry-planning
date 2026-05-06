// src/components/reports/widgets/section-head.tsx
//
// Screen render for the sectionHead widget. Mono eyebrow above a big serif
// title, a 2px accent underline beneath the title (~60% width), and an
// optional intro paragraph below. ClassNames use the `report-*` namespace
// so the widget renders in the cream/light report theme inside the dark
// app shell.
//
// PDF render lives at `components/reports-pdf/widgets/section-head.tsx`
// and is wired onto the registry entry by
// `lib/reports/widgets/section-head.pdf.ts`, server-only.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function SectionHeadRender({ props }: WidgetRenderProps<"sectionHead">) {
  return (
    <div className="pt-2">
      <div className="text-[11px] font-mono uppercase tracking-wider text-report-accent mb-2">
        {props.eyebrow}
      </div>
      <div className="text-2xl font-serif font-medium text-report-ink leading-tight">
        {props.title}
      </div>
      <div className="mt-3 w-3/5 border-b-2 border-report-accent" />
      {props.intro && (
        <div className="mt-4 text-sm text-report-ink-2 leading-relaxed">
          {props.intro}
        </div>
      )}
    </div>
  );
}
