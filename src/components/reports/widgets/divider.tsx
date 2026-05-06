// src/components/reports/widgets/divider.tsx
//
// Screen render for the divider widget — a horizontal rule used to split
// a page visually. The `variant` prop selects between `hair` (default,
// 1px hairline) and `accent` (1.5px accent rule) styles. Distinct from
// `components/reports/page-divider.tsx`, which is the builder-chrome
// control between pages; this is the user-addable widget that lives
// inside a page row.

import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

export function DividerRender({ props }: WidgetRenderProps<"divider">) {
  const variant = props.variant ?? "hair";
  return (
    <div className="py-4">
      {variant === "accent" ? (
        <div className="border-t-[1.5px] border-report-accent" />
      ) : (
        <div className="border-t border-report-hair" />
      )}
    </div>
  );
}
