// src/components/reports-pdf/widgets/life-phases-table.tsx
//
// PDF render for the lifePhasesTable widget. Mirrors the screen render's
// branded table treatment: dark header row, zebra rows, hairline
// separators. All cells left-aligned (free-text data).

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

const s = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: PDF_THEME.radii.card,
    overflow: "hidden",
  },
  header: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8 },
  title: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    color: PDF_THEME.ink,
  },
  headRow: {
    flexDirection: "row",
    backgroundColor: PDF_THEME.inkDeep,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  headCell: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.inkOnDark,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.hair,
  },
  rowCard: { backgroundColor: PDF_THEME.card2 },
  rowZebra: { backgroundColor: PDF_THEME.zebra },
  cell: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink,
  },
  empty: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.hair,
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    textAlign: "center",
  },
});

export function LifePhasesTablePdfRender({
  props,
}: WidgetRenderProps<"lifePhasesTable">) {
  const rows = props.rows ?? [];
  return (
    <View style={s.wrap}>
      {props.title ? (
        <View style={s.header}>
          <Text style={s.title}>{props.title}</Text>
        </View>
      ) : null}
      <View style={s.headRow}>
        <Text style={s.headCell}>Phase</Text>
        <Text style={s.headCell}>Years</Text>
        <Text style={s.headCell}>Ages</Text>
      </View>
      {rows.length === 0 ? (
        <Text style={s.empty}>No phases — add rows in the inspector.</Text>
      ) : (
        rows.map((r, i) => (
          <View
            key={i}
            style={[s.row, i % 2 === 0 ? s.rowCard : s.rowZebra]}
          >
            <Text style={s.cell}>{r.phase}</Text>
            <Text style={s.cell}>{r.years}</Text>
            <Text style={s.cell}>{r.ages}</Text>
          </View>
        ))
      )}
    </View>
  );
}
