// src/components/reports-pdf/widgets/section-head.tsx
//
// PDF render for the sectionHead widget. Mirrors the screen render
// structure (mono eyebrow, big serif title, top hairline rule) but uses
// @react-pdf/renderer primitives + PDF_THEME tokens.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { PDF_THEME } from "../theme";

const s = StyleSheet.create({
  wrap: { borderTopWidth: 1, borderColor: PDF_THEME.hair, paddingTop: 14 },
  eyebrow: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.accent,
    marginBottom: 6,
  },
  title: { fontFamily: "Fraunces", fontSize: 22, color: PDF_THEME.ink },
});

export function SectionHeadPdfRender({ props }: WidgetRenderProps<"sectionHead">) {
  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>{props.eyebrow}</Text>
      <Text style={s.title}>{props.title}</Text>
    </View>
  );
}
