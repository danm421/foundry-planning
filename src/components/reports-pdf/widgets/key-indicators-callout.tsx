// src/components/reports-pdf/widgets/key-indicators-callout.tsx
//
// PDF render for the keyIndicatorsCallout widget. Mirrors the screen
// render's bordered card with optional Fraunces subsection-styled title,
// bulleted body rows in body type, and optional muted italic notes.

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
  title: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    color: PDF_THEME.ink,
    marginBottom: 6,
  },
  bulletRow: {
    flexDirection: "row",
    marginTop: 3,
  },
  bulletGlyph: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.body.pdfPx,
    color: PDF_THEME.ink2,
    marginRight: 6,
  },
  bulletText: {
    flex: 1,
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.body.pdfPx,
    color: PDF_THEME.ink,
    lineHeight: 1.5,
  },
  empty: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
  },
  notes: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    marginTop: 8,
    lineHeight: 1.4,
  },
});

export function KeyIndicatorsCalloutPdfRender({
  props,
}: WidgetRenderProps<"keyIndicatorsCallout">) {
  // Mirror the screen render: drop empty bullets so a trailing blank line
  // in the inspector textarea doesn't print as an empty bullet row.
  const visible = props.bullets.filter((b) => b.trim().length > 0);
  return (
    <View style={s.wrap}>
      {props.title ? <Text style={s.title}>{props.title}</Text> : null}
      {visible.length === 0 ? (
        <Text style={s.empty}>No indicators yet.</Text>
      ) : (
        visible.map((bullet, i) => (
          <View key={i} style={s.bulletRow}>
            <Text style={s.bulletGlyph}>•</Text>
            <Text style={s.bulletText}>{bullet}</Text>
          </View>
        ))
      )}
      {props.notes ? <Text style={s.notes}>{props.notes}</Text> : null}
    </View>
  );
}
