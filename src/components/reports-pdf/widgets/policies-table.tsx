// src/components/reports-pdf/widgets/policies-table.tsx
//
// PDF render for the policiesTable widget. Mirrors the screen render's
// branded table treatment with `<View>`-based rows.
//
// Four columns: Type / Owner / Death Benefit / Annual Premium. Numeric
// columns are right-aligned. `deathBenefit` is optional (non-life
// policies omit it); empty cells render as an em dash.
//
// When `rows.length === 0` the widget renders the configured
// `emptyStateMessage` inside a tinted bordered card painted with the
// `crit` palette — the empty state is a planning signal, not just
// missing data.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";

const FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

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
  cellBold: { fontWeight: 500 },
  cellNum: { textAlign: "right" },
  emptyCard: {
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    borderLeftWidth: 3,
    borderLeftColor: PDF_THEME.crit,
    backgroundColor: PDF_THEME.critTint,
    borderRadius: PDF_THEME.radii.card,
    padding: 12,
  },
  emptyTitle: {
    fontFamily: "Fraunces",
    fontSize: PDF_THEME.type.titleSubsection.pdfPx,
    color: PDF_THEME.crit,
    marginBottom: 4,
  },
  emptyBody: {
    fontFamily: "Inter",
    fontSize: PDF_THEME.type.body.pdfPx,
    color: PDF_THEME.crit,
    lineHeight: 1.4,
  },
});

export function PoliciesTablePdfRender({
  props,
}: WidgetRenderProps<"policiesTable">) {
  const { title, rows, emptyStateMessage } = props;

  if (rows.length === 0) {
    return (
      <View style={s.emptyCard}>
        {title ? <Text style={s.emptyTitle}>{title}</Text> : null}
        <Text style={s.emptyBody}>
          {emptyStateMessage ?? "No policies on file."}
        </Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {title ? (
        <View style={s.header}>
          <Text style={s.title}>{title}</Text>
        </View>
      ) : null}
      <View style={s.headRow}>
        <Text style={s.headCell}>Type</Text>
        <Text style={s.headCell}>Owner</Text>
        <Text style={[s.headCell, s.cellNum]}>Death Benefit</Text>
        <Text style={[s.headCell, s.cellNum]}>Annual Premium</Text>
      </View>
      {rows.map((row, i) => (
        <View
          key={i}
          style={[s.row, i % 2 === 0 ? s.rowCard : s.rowZebra]}
        >
          <Text style={[s.cell, s.cellBold]}>{row.type}</Text>
          <Text style={s.cell}>{row.owner}</Text>
          <Text style={[s.cell, s.cellNum]}>
            {row.deathBenefit !== undefined
              ? FMT.format(row.deathBenefit)
              : "—"}
          </Text>
          <Text style={[s.cell, s.cellNum]}>
            {FMT.format(row.annualPremium)}
          </Text>
        </View>
      ))}
    </View>
  );
}
