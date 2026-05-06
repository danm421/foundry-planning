// src/components/reports-pdf/widgets/section-head.tsx
//
// PDF render for the sectionHead widget. Mono eyebrow above a big serif
// title, with a 2pt accent underline beneath the title (200pt wide) and
// an optional `intro` paragraph below. Mirrors the screen render — the
// rule sits UNDER the title rather than above the eyebrow.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { PDF_THEME } from "../theme";

const s = StyleSheet.create({
  wrap: { flexDirection: "column" },
  eyebrow: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.accent,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    fontFamily: "Fraunces",
    fontSize: 22,
    color: PDF_THEME.ink,
  },
  underline: {
    width: 200,
    height: 2,
    backgroundColor: PDF_THEME.accent,
    marginTop: 8,
  },
  intro: {
    fontFamily: "Inter",
    fontSize: 10,
    color: PDF_THEME.ink2,
    lineHeight: 1.5,
    marginTop: 12,
  },
});

export function SectionHeadPdfRender({ props }: WidgetRenderProps<"sectionHead">) {
  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>{props.eyebrow}</Text>
      <Text style={s.title}>{props.title}</Text>
      <View style={s.underline} />
      {props.intro ? <Text style={s.intro}>{props.intro}</Text> : null}
    </View>
  );
}
