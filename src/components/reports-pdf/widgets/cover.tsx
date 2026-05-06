// src/components/reports-pdf/widgets/cover.tsx
//
// PDF render for the cover widget. The cover owns its page and the
// page-wrapper drops all padding + sets the page background to `inkDeep`
// when `isCover` is true, so this view paints the entire sheet.
//
// Layout mirrors the Ethos cover: 5pt accent rules at top + bottom edges,
// centered stack of mono eyebrow / serif title / accent subtitle /
// prepared-by + date, and a Personal & Confidential block at the bottom.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { PDF_THEME } from "../theme";

const s = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: PDF_THEME.inkDeep,
    flexDirection: "column",
  },
  topRule: { height: 5, backgroundColor: PDF_THEME.accent },
  bottomRule: { height: 5, backgroundColor: PDF_THEME.accent },
  center: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 72,
  },
  eyebrow: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.accent,
    marginBottom: 24,
    textTransform: "uppercase",
    letterSpacing: 2.5,
  },
  title: {
    fontFamily: "Fraunces",
    fontSize: 36,
    fontWeight: 600,
    color: PDF_THEME.inkOnDark,
    textAlign: "center",
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: "Inter",
    fontSize: 14,
    color: PDF_THEME.accent,
    textAlign: "center",
    marginBottom: 32,
  },
  preparedBy: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.inkOnDark,
    opacity: 0.8,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginTop: 24,
  },
  date: {
    fontFamily: "Inter",
    fontSize: 10,
    color: PDF_THEME.inkOnDark,
    opacity: 0.6,
    marginTop: 6,
  },
  footer: {
    paddingHorizontal: 72,
    paddingBottom: 48,
    flexDirection: "column",
    alignItems: "center",
  },
  confidential: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.inkOnDark,
    opacity: 0.6,
    textTransform: "uppercase",
    letterSpacing: 1.5,
  },
  address: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PDF_THEME.inkOnDark,
    opacity: 0.4,
    marginTop: 4,
  },
});

export function CoverPdfRender({ props }: WidgetRenderProps<"cover">) {
  const year = props.year ?? new Date().getFullYear();
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return (
    <View style={s.wrap}>
      <View style={s.topRule} />
      <View style={s.center}>
        <Text style={s.eyebrow}>Foundry · {year}</Text>
        <Text style={s.title}>{props.title || "Annual Review"}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
        <Text style={s.preparedBy}>Prepared by Foundry Planning</Text>
        <Text style={s.date}>{today}</Text>
      </View>
      <View style={s.footer}>
        <Text style={s.confidential}>Personal &amp; Confidential</Text>
        <Text style={s.address}>
          Foundry Planning · 1 Market Street, San Francisco, CA
        </Text>
      </View>
      <View style={s.bottomRule} />
    </View>
  );
}
