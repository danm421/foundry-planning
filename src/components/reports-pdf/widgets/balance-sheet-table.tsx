// src/components/reports-pdf/widgets/balance-sheet-table.tsx
//
// PDF render for the balanceSheetTable widget. Mirrors the screen render with
// `<View>`-based rows (no HTML <table> in @react-pdf/renderer). Same v1
// scoping as the screen: category totals + grand totals only; entity
// breakdown deferred.

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
    padding: 8,
    borderWidth: 1,
    borderColor: PDF_THEME.hair,
    backgroundColor: PDF_THEME.card2,
    borderRadius: 3,
  },
  title: { fontSize: 12, color: PDF_THEME.ink, marginBottom: 6 },
  subtitle: { fontSize: 9, color: PDF_THEME.ink3, marginBottom: 6 },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderColor: PDF_THEME.hair,
    paddingVertical: 4,
  },
  totalRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: PDF_THEME.ink,
    paddingVertical: 4,
  },
  cell: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    color: PDF_THEME.ink,
  },
  cellNum: { textAlign: "right" },
});

export function BalanceSheetTablePdfRender({
  props,
  data,
}: WidgetRenderProps<"balanceSheetTable">) {
  const vm = data as BalanceSheetViewModel | undefined;
  if (!vm) {
    return (
      <View style={s.wrap}>
        <Text style={s.title}>{props.title}</Text>
        <Text style={s.subtitle}>No data available.</Text>
      </View>
    );
  }
  return (
    <View style={s.wrap}>
      <Text style={s.title}>{props.title}</Text>
      {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
      {vm.assetCategories.map((cat) => (
        <View key={cat.key} style={s.row}>
          <Text style={s.cell}>{cat.label}</Text>
          <Text style={[s.cell, s.cellNum]}>{FMT.format(cat.total)}</Text>
        </View>
      ))}
      <View style={s.totalRow}>
        <Text style={s.cell}>Total assets</Text>
        <Text style={[s.cell, s.cellNum]}>{FMT.format(vm.totalAssets)}</Text>
      </View>
      <View style={s.row}>
        <Text style={s.cell}>Total liabilities</Text>
        <Text style={[s.cell, s.cellNum]}>
          {FMT.format(vm.totalLiabilities)}
        </Text>
      </View>
      <View style={s.totalRow}>
        <Text style={s.cell}>Net worth</Text>
        <Text
          style={[
            s.cell,
            s.cellNum,
            { color: vm.netWorth >= 0 ? PDF_THEME.good : PDF_THEME.crit },
          ]}
        >
          {FMT.format(vm.netWorth)}
        </Text>
      </View>
    </View>
  );
}
