// src/components/reports-pdf/widgets/status-callout.tsx
//
// PDF render for the statusCallout widget. Mirrors the screen render's
// rounded card with a 3px colored left border (status hue), tinted
// background, hairline border on the other three sides, leading status
// glyph, optional colored headline, and a body line.
//
// All colors flow through `PDF_THEME` (re-exported from `lib/reports/
// theme.ts`) so the screen + PDF surfaces stay in sync.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { StatusCalloutProps } from "@/lib/reports/types";
import { PDF_THEME } from "../theme";

type Status = StatusCalloutProps["status"];

const STATUS_STYLES: Record<
  Status,
  { bg: string; ink: string; border: string; glyph: string }
> = {
  go: {
    bg: PDF_THEME.goodTint,
    ink: PDF_THEME.good,
    border: PDF_THEME.good,
    glyph: "✓",
  },
  warn: {
    bg: PDF_THEME.accentTint,
    ink: PDF_THEME.accent,
    border: PDF_THEME.accent,
    glyph: "⚠",
  },
  risk: {
    bg: PDF_THEME.critTint,
    ink: PDF_THEME.crit,
    border: PDF_THEME.crit,
    glyph: "!",
  },
};

const s = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    padding: 14,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderLeftWidth: 3,
    borderTopColor: PDF_THEME.hair,
    borderRightColor: PDF_THEME.hair,
    borderBottomColor: PDF_THEME.hair,
    borderRadius: PDF_THEME.radii.card,
  },
  glyph: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    marginRight: 10,
    marginTop: 1,
  },
  body: { flex: 1 },
  headline: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    marginBottom: 3,
  },
  text: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.body.pdfPx,
    color: PDF_THEME.ink,
    lineHeight: 1.5,
  },
  notes: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    marginTop: 6,
    lineHeight: 1.4,
  },
});

export function StatusCalloutPdfRender({
  props,
}: WidgetRenderProps<"statusCallout">) {
  const style = STATUS_STYLES[props.status];
  return (
    <View
      style={[
        s.wrap,
        { backgroundColor: style.bg, borderLeftColor: style.border },
      ]}
    >
      <Text style={[s.glyph, { color: style.ink }]}>{style.glyph}</Text>
      <View style={s.body}>
        {props.headline ? (
          <Text style={[s.headline, { color: style.ink }]}>
            {props.headline}
          </Text>
        ) : null}
        <Text style={s.text}>{props.body}</Text>
        {props.notes ? <Text style={s.notes}>{props.notes}</Text> : null}
      </View>
    </View>
  );
}
