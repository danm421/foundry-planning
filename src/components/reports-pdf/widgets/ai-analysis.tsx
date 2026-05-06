// src/components/reports-pdf/widgets/ai-analysis.tsx
//
// PDF render for the aiAnalysis widget. Mirrors the screen render's
// minimal markdown subset — paragraphs (split on blank lines) and bullet
// lists (paragraphs whose lines start with `- `). Server-only; no hooks
// or interactive state since the PDF has no Generate / Edit affordances.
//
// Deliberate light/dark inversion matches advisor-commentary: screen
// builder uses dark `bg-card-2`; PDF goes to clients on light paper.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

const s = StyleSheet.create({
  wrap: {
    padding: 12,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: 3,
  },
  title: { fontSize: 12, color: PDF_THEME.ink, marginBottom: 8 },
  body: { fontSize: 10, color: PDF_THEME.ink, lineHeight: 1.5 },
  para: { marginBottom: 6 },
  bullet: { marginLeft: 8 },
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
    </View>
  );
}
