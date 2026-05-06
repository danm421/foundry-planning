// src/components/reports-pdf/widgets/advisor-commentary.tsx
//
// PDF render for the advisorCommentary widget. Mirrors the screen
// render's optional uppercase mono headline + body paragraph using
// @react-pdf/renderer primitives + PDF_THEME tokens.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { PDF_THEME } from "../theme";

const s = StyleSheet.create({
  wrap: {
    padding: 14,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: 4,
  },
  headline: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.accent,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  body: { fontSize: 11, color: PDF_THEME.ink, lineHeight: 1.5 },
});

// Deliberate light/dark inversion: screen builder uses dark `bg-card-2`; PDF goes to clients on light paper.
export function AdvisorCommentaryPdfRender({
  props,
}: WidgetRenderProps<"advisorCommentary">) {
  return (
    <View style={s.wrap}>
      {props.headline ? <Text style={s.headline}>{props.headline}</Text> : null}
      <Text style={s.body}>{props.body}</Text>
    </View>
  );
}
