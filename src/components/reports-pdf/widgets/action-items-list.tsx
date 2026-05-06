// src/components/reports-pdf/widgets/action-items-list.tsx
//
// PDF render for the actionItemsList widget. Mirrors the screen render:
// subsection-styled title with an accent underline above a flat list of
// priority-tagged items. Each item: `[HIGH]` / `[MED]` / `[LOW]` chip
// in mono uppercase + colored, the action text, and an optional muted
// `(timeframe)` suffix.
//
// `@react-pdf/renderer` uses View/Text rather than HTML lists. The
// "bullet" is the colored priority chip itself.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

type Priority = "high" | "medium" | "low";

const PRIORITY_LABEL: Record<Priority, string> = {
  high: "HIGH",
  medium: "MED",
  low: "LOW",
};

const PRIORITY_COLOR: Record<Priority, string> = {
  high: PDF_THEME.crit,
  medium: PDF_THEME.accent,
  low: PDF_THEME.ink3,
};

const s = StyleSheet.create({
  wrap: { flexDirection: "column" },
  titleBlock: {
    paddingBottom: 6,
    marginBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: PDF_THEME.accent,
  },
  title: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    color: PDF_THEME.ink,
  },
  empty: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
  },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 6,
  },
  priority: {
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    letterSpacing: 0.5,
    fontWeight: 500,
    marginRight: 6,
    paddingTop: 1, // baseline-ish alignment with the body text
  },
  body: {
    flex: 1,
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.body.pdfPx,
    color: PDF_THEME.ink,
    lineHeight: 1.4,
  },
  timeframe: {
    color: PDF_THEME.ink3,
  },
});

export function ActionItemsListPdfRender({
  props,
}: WidgetRenderProps<"actionItemsList">) {
  const items = props.items ?? [];
  return (
    <View style={s.wrap}>
      {props.title ? (
        <View style={s.titleBlock}>
          <Text style={s.title}>{props.title}</Text>
        </View>
      ) : null}
      {items.length === 0 ? (
        <Text style={s.empty}>No action items.</Text>
      ) : (
        items.map((it, i) => (
          <View key={i} style={s.item}>
            <Text style={[s.priority, { color: PRIORITY_COLOR[it.priority] }]}>
              [{PRIORITY_LABEL[it.priority]}]
            </Text>
            <Text style={s.body}>
              {it.text}
              {it.timeframe ? (
                <Text style={s.timeframe}> ({it.timeframe})</Text>
              ) : null}
            </Text>
          </View>
        ))
      )}
    </View>
  );
}
