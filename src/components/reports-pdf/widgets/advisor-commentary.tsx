// src/components/reports-pdf/widgets/advisor-commentary.tsx
//
// PDF render for the advisorCommentary widget. Mirrors the screen
// render's bordered card with optional Fraunces subsection-styled
// headline, body in body role, and optional muted italic notes. Shares
// the exact visual treatment with `aiAnalysis` so they read as a single
// narrative widget pattern.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { PDF_THEME } from "../theme";

const s = StyleSheet.create({
  wrap: {
    padding: 16,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: PDF_THEME.radii.card,
  },
  headline: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    color: PDF_THEME.ink,
    marginBottom: 6,
  },
  body: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.body.pdfPx,
    color: PDF_THEME.ink,
    lineHeight: 1.5,
  },
  notes: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    marginTop: 8,
    lineHeight: 1.4,
  },
});

export function AdvisorCommentaryPdfRender({
  props,
}: WidgetRenderProps<"advisorCommentary">) {
  return (
    <View style={s.wrap}>
      {props.headline ? <Text style={s.headline}>{props.headline}</Text> : null}
      <Text style={s.body}>{props.body}</Text>
      {props.notes ? <Text style={s.notes}>{props.notes}</Text> : null}
    </View>
  );
}
