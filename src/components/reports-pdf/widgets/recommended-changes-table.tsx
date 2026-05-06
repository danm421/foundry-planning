// src/components/reports-pdf/widgets/recommended-changes-table.tsx
//
// PDF render for the recommendedChangesTable widget. Mirrors the screen
// render's branded table treatment with `<View>`-based rows (no HTML
// <table> in @react-pdf/renderer).
//
// `props.variant`:
//   - "list"             → single "Change" column (executive summary)
//   - "currentVsProposed" → 3 columns: "Change / Current / Proposed"
//
// Each "change" cell is prefixed with a green checkmark glyph rendered
// inline so authors see the same recommended-row signal in PDF as on
// screen.

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
  changeCell: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-start",
  },
  check: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.good,
    marginRight: 6,
  },
  changeText: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink,
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

export function RecommendedChangesTablePdfRender({
  props,
}: WidgetRenderProps<"recommendedChangesTable">) {
  const { title, variant, rows } = props;
  const isCurrentVsProposed = variant === "currentVsProposed";

  return (
    <View style={s.wrap}>
      {title ? (
        <View style={s.header}>
          <Text style={s.title}>{title}</Text>
        </View>
      ) : null}
      <View style={s.headRow}>
        <Text style={s.headCell}>Change</Text>
        {isCurrentVsProposed ? (
          <>
            <Text style={s.headCell}>Current</Text>
            <Text style={s.headCell}>Proposed</Text>
          </>
        ) : null}
      </View>
      {rows.length === 0 ? (
        <View style={s.emptyRow}>
          <Text style={s.emptyText}>No recommended changes.</Text>
        </View>
      ) : (
        rows.map((row, i) => (
          <View
            key={i}
            style={[s.row, i % 2 === 0 ? s.rowCard : s.rowZebra]}
          >
            <View style={s.changeCell}>
              <Text style={s.check}>✓</Text>
              <Text style={s.changeText}>{row.change}</Text>
            </View>
            {isCurrentVsProposed ? (
              <>
                <Text style={s.cell}>{row.current ?? ""}</Text>
                <Text style={s.cell}>{row.proposed ?? ""}</Text>
              </>
            ) : null}
          </View>
        ))
      )}
    </View>
  );
}
