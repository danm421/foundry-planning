// src/components/reports-pdf/widgets/risk-table.tsx
//
// PDF render for the riskTable widget. Mirrors the screen render's
// branded table treatment with `<View>`-based rows (no HTML <table> in
// @react-pdf/renderer).
//
// Three columns: Risk Area / Description / Severity. The severity cell
// renders a colored filled pill — small uppercase mono label inside a
// rounded rect, painted with the severity color from the design system.
//
// Severity → color mapping mirrors the screen render exactly. low →
// `good`, medium → `accent`, high → `crit`. All colors via PDF_THEME;
// no inlined hex.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { RiskSeverity } from "@/lib/reports/types";

const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  low: PDF_THEME.good,
  medium: PDF_THEME.accent,
  high: PDF_THEME.crit,
};

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
  headCellSeverity: {
    width: 70,
    flex: 0,
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
    alignItems: "center",
  },
  rowCard: { backgroundColor: PDF_THEME.card2 },
  rowZebra: { backgroundColor: PDF_THEME.zebra },
  cell: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink,
  },
  cellArea: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink,
    fontWeight: 500,
  },
  cellSeverity: {
    width: 70,
    flex: 0,
    flexDirection: "row",
  },
  pill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 3,
  },
  pillText: {
    fontFamily: "JetBrains Mono",
    fontSize: 8,
    color: PDF_THEME.inkOnDark,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  emptyRow: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
  },
  emptyText: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
  },
});

export function RiskTablePdfRender({
  props,
}: WidgetRenderProps<"riskTable">) {
  const { title, rows } = props;

  return (
    <View style={s.wrap}>
      {title ? (
        <View style={s.header}>
          <Text style={s.title}>{title}</Text>
        </View>
      ) : null}
      <View style={s.headRow}>
        <Text style={s.headCell}>Risk Area</Text>
        <Text style={s.headCell}>Description</Text>
        <Text style={s.headCellSeverity}>Severity</Text>
      </View>
      {rows.length === 0 ? (
        <View style={s.emptyRow}>
          <Text style={s.emptyText}>No risks identified.</Text>
        </View>
      ) : (
        rows.map((row, i) => (
          <View
            key={i}
            style={[s.row, i % 2 === 0 ? s.rowCard : s.rowZebra]}
          >
            <Text style={s.cellArea}>{row.area}</Text>
            <Text style={s.cell}>{row.description}</Text>
            <View style={s.cellSeverity}>
              <View
                style={[
                  s.pill,
                  { backgroundColor: SEVERITY_COLOR[row.severity] },
                ]}
              >
                <Text style={s.pillText}>{row.severity}</Text>
              </View>
            </View>
          </View>
        ))
      )}
    </View>
  );
}
