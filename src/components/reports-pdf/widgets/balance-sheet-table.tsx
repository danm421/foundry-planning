// src/components/reports-pdf/widgets/balance-sheet-table.tsx
//
// PDF render for the balanceSheetTable widget. Mirrors the screen render with
// `<View>`-based rows (no HTML <table> in @react-pdf/renderer). Same v1
// scoping as the screen: category totals + grand totals only; entity
// breakdown deferred.
//
// Visual treatment matches the Ethos comparison redesign branded table:
// dark header row (`inkDeep`/`inkOnDark`), zebra rows alternating
// `card2`/`zebra`, hairline separators, right-aligned numeric cells, and
// a 1.5px `accent`-colored separator above the "Net worth" totals row.

import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "../theme";
import type { WidgetRenderProps } from "@/lib/reports/widget-registry";
import type { BalanceSheetViewModel } from "@/components/balance-sheet-report/view-model";

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
  subtitle: {
    fontSize: PDF_THEME.type.caption.pdfPx,
    color: PDF_THEME.ink3,
    marginTop: 2,
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
  totalsRow: {
    flexDirection: "row",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderTopWidth: 1.5,
    borderTopColor: PDF_THEME.accent,
    backgroundColor: PDF_THEME.card2,
  },
  cell: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink,
  },
  cellNum: { textAlign: "right" },
  cellBold: { fontWeight: 500 },
});

export function BalanceSheetTablePdfRender({
  props,
  data,
}: WidgetRenderProps<"balanceSheetTable">) {
  const vm = data as BalanceSheetViewModel | undefined;
  if (!vm) {
    return (
      <View style={s.wrap}>
        <View style={s.header}>
          <Text style={s.title}>{props.title}</Text>
          <Text style={s.subtitle}>No data available.</Text>
        </View>
      </View>
    );
  }

  // Zebra index continues across the synthetic "Total assets" / "Total
  // liabilities" rows so stripes stay consistent.
  const rows: { label: string; value: number }[] = [
    ...vm.assetCategories.map((c) => ({ label: c.label, value: c.total })),
    { label: "Total assets", value: vm.totalAssets },
    { label: "Total liabilities", value: vm.totalLiabilities },
  ];

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <Text style={s.title}>{props.title}</Text>
        {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      </View>
      <View style={s.headRow}>
        <Text style={s.headCell}>Category</Text>
        <Text style={[s.headCell, s.cellNum]}>Value</Text>
      </View>
      {rows.map((r, i) => {
        const isTotalAssets = r.label === "Total assets";
        return (
          <View
            key={r.label}
            style={[s.row, i % 2 === 0 ? s.rowCard : s.rowZebra]}
          >
            <Text style={[s.cell, isTotalAssets ? s.cellBold : {}]}>
              {r.label}
            </Text>
            <Text
              style={[s.cell, s.cellNum, isTotalAssets ? s.cellBold : {}]}
            >
              {FMT.format(r.value)}
            </Text>
          </View>
        );
      })}
      <View style={s.totalsRow}>
        <Text style={[s.cell, s.cellBold]}>Net worth</Text>
        <Text
          style={[
            s.cell,
            s.cellNum,
            s.cellBold,
            { color: vm.netWorth >= 0 ? PDF_THEME.good : PDF_THEME.crit },
          ]}
        >
          {FMT.format(vm.netWorth)}
        </Text>
      </View>
    </View>
  );
}
