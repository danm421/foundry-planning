// src/components/reports/widgets/cover.tsx
//
// Screen render for the cover widget. The cover is `ownsPage: true` —
// the reducer guarantees no other widget shares its page, and the
// builder gives it the full sheet to render into. Aspect ratio matches
// US Letter portrait (8.5:11) so the screen preview reads as a page.
//
// PDF render lives at `components/reports-pdf/widgets/cover.tsx` and is
// attached to the registry entry by `lib/reports/widgets/cover.pdf.ts`,
// which only loads in the server bundle.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function CoverRender({ props }: WidgetRenderProps<"cover">) {
  return (
    <div className="aspect-[8.5/11] bg-card border border-hair rounded-sm flex flex-col justify-end p-12">
      <div className="text-[11px] font-mono uppercase tracking-wider text-accent mb-3">
        Foundry · {props.year ?? new Date().getFullYear()}
      </div>
      <div className="text-[40px] font-serif text-ink leading-tight">
        {props.title || "Annual Review"}
      </div>
      {props.subtitle && (
        <div className="text-[16px] text-ink-3 mt-2">{props.subtitle}</div>
      )}
    </div>
  );
}
