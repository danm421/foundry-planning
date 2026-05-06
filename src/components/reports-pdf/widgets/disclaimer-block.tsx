// src/components/reports-pdf/widgets/disclaimer-block.tsx
//
// PDF render for the disclaimerBlock widget. 1.5pt accent rule across
// the top, padded muted-italic small-print body below. Mirrors the
// screen render's treatment.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

const s = StyleSheet.create({
  wrap: {
    borderTopWidth: 1.5,
    borderTopColor: PDF_THEME.accent,
    paddingTop: 8,
  },
  body: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    fontStyle: "italic",
    lineHeight: 1.4,
  },
});

export function DisclaimerBlockPdfRender({
  props,
}: WidgetRenderProps<"disclaimerBlock">) {
  return (
    <View style={s.wrap}>
      <Text style={s.body}>{props.body}</Text>
    </View>
  );
}
