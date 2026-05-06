// src/components/reports/widgets/cover.tsx
//
// Screen render for the cover widget. The cover is `ownsPage: true` —
// the reducer guarantees no other widget shares its page, and the
// builder gives it the full sheet to render into. Aspect ratio matches
// US Letter portrait (8.5:11) so the screen preview reads as a page.
//
// Visual treatment matches the Ethos comparison-redesign cover: full-bleed
// `inkDeep` background, `accent` rules at the top + bottom edges, and a
// vertically-centered stack with mono eyebrow, large serif title, optional
// accent subtitle, prepared-by line, and date. The classNames use the
// `report-*` namespace tokens so the cream/dark report theme renders
// consistently regardless of the surrounding dark app shell.
//
// PDF render lives at `components/reports-pdf/widgets/cover.tsx` and is
// attached to the registry entry by `lib/reports/widgets/cover.pdf.ts`,
// which only loads in the server bundle.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function CoverRender({ props }: WidgetRenderProps<"cover">) {
  const year = props.year ?? new Date().getFullYear();
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <div className="aspect-[8.5/11] bg-report-ink-deep relative flex flex-col">
      {/* Top accent rule */}
      <div className="h-[5px] bg-report-accent shrink-0" />
      {/* Centered stack — uses flex-1 + justify-center to vertically center */}
      <div className="flex-1 flex flex-col items-center justify-center px-12 text-center">
        <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-report-accent mb-6">
          Foundry · {year}
        </div>
        <div className="text-4xl md:text-[44px] font-serif text-report-ink-on-dark leading-[1.1] mb-3">
          {props.title || "Annual Review"}
        </div>
        {props.subtitle && (
          <div className="text-base text-report-accent mb-10">
            {props.subtitle}
          </div>
        )}
        <div className="mt-8 text-[11px] font-mono uppercase tracking-wider text-report-ink-on-dark/80">
          Prepared by Foundry Planning
        </div>
        <div className="mt-2 text-xs text-report-ink-on-dark/60">{today}</div>
      </div>
      {/* Bottom address + confidential block */}
      <div className="px-12 pb-10 text-center">
        <div className="text-[10px] font-mono uppercase tracking-wider text-report-ink-on-dark/60">
          Personal &amp; Confidential
        </div>
        <div className="mt-1 text-[10px] text-report-ink-on-dark/40">
          Foundry Planning · 1 Market Street, San Francisco, CA
        </div>
      </div>
      {/* Bottom accent rule */}
      <div className="h-[5px] bg-report-accent shrink-0" />
    </div>
  );
}
