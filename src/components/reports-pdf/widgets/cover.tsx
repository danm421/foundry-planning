// src/components/reports-pdf/widgets/cover.tsx
//
// PDF render for the cover widget. Mirrors the screen render structure
// (Foundry/year eyebrow, big serif title, optional subtitle) but uses
// @react-pdf/renderer primitives + PDF_THEME tokens. The widget owns
// its page, so this view fills the full sheet — `flex: 1` plus
// bottom-anchored content matches the screen preview.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import { PDF_THEME } from "../theme";

const s = StyleSheet.create({
  wrap: { flex: 1, flexDirection: "column", justifyContent: "flex-end" },
  eyebrow: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.accent,
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  title: {
    fontFamily: "Fraunces",
    fontSize: 36,
    fontWeight: 600,
    color: PDF_THEME.ink,
  },
  subtitle: { fontSize: 14, color: PDF_THEME.ink2, marginTop: 6 },
});

export function CoverPdfRender({ props }: WidgetRenderProps<"cover">) {
  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>
        Foundry · {props.year ?? new Date().getFullYear()}
      </Text>
      <Text style={s.title}>{props.title || "Annual Review"}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
    </View>
  );
}
