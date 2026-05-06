// src/components/reports-pdf/widgets/ai-analysis.tsx
//
// PDF render for the aiAnalysis widget. Mirrors the screen render's
// minimal markdown subset — paragraphs (split on blank lines) and bullet
// lists (paragraphs whose lines start with `- `). Server-only; no hooks
// or interactive state since the PDF has no Generate / Edit affordances.
//
// Visual treatment matches `advisorCommentary` exactly (cream/light
// bordered card, Fraunces subsection-styled title, body in body role,
// muted italic notes) so the two widgets read as a single narrative
// widget pattern.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

const s = StyleSheet.create({
  wrap: {
    padding: 16,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: PDF_THEME.radii.card,
  },
  title: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    color: PDF_THEME.ink,
    marginBottom: 8,
  },
  body: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.body.pdfPx,
    color: PDF_THEME.ink,
    lineHeight: 1.5,
  },
  para: { marginBottom: 6 },
  bullet: { marginLeft: 8 },
  notes: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    fontStyle: "italic",
    marginTop: 8,
    lineHeight: 1.4,
  },
});

export function AiAnalysisPdfRender({
  props,
}: WidgetRenderProps<"aiAnalysis">) {
  const paragraphs = props.body.split(/\n{2,}/);
  return (
    <View style={s.wrap}>
      {props.title ? <Text style={s.title}>{props.title}</Text> : null}
      {paragraphs.map((para, i) => {
        if (para.startsWith("- ")) {
          const items = para
            .split("\n")
            .map((line) => line.replace(/^-\s*/, ""))
            .filter((line) => line.length > 0);
          return (
            <View key={i} style={s.para}>
              {items.map((it, j) => (
                <Text key={j} style={[s.body, s.bullet]}>
                  {`• ${it}`}
                </Text>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} style={[s.body, s.para]}>
            {para}
          </Text>
        );
      })}
      {props.notes ? <Text style={s.notes}>{props.notes}</Text> : null}
    </View>
  );
}
