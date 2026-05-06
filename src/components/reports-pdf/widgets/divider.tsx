// src/components/reports-pdf/widgets/divider.tsx
//
// PDF render for the divider widget — a horizontal rule with two
// variants: `hair` (default, 1pt hairline) and `accent` (1.5pt accent
// rule). Mirrors the screen render with @react-pdf/renderer primitives
// and PDF_THEME tokens.

import { View } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { PDF_THEME } from "../theme";

export function DividerPdfRender({ props }: WidgetRenderProps<"divider">) {
  const variant = props.variant ?? "hair";
  const thickness = variant === "accent" ? 1.5 : 1;
  const color = variant === "accent" ? PDF_THEME.accent : PDF_THEME.hair;
  return (
    <View
      style={{
        borderTopWidth: thickness,
        borderColor: color,
        marginVertical: 12,
      }}
    />
  );
}
