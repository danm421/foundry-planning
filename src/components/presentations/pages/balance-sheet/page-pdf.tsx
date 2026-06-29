import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { BalanceSheetPageData } from "@/lib/presentations/pages/balance-sheet/view-model";
import type { YoyResult } from "@/components/balance-sheet-report/yoy";
import { exactCurrency as fmt } from "@/lib/presentations/format";

const S = StyleSheet.create({
  kpiRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  kpiCard: {
    flex: 1,
    borderWidth: 0.5,
    borderColor: T.hair2,
    borderRadius: 4,
    padding: 10,
    backgroundColor: T.card,
  },
  kpiLabel: {
    fontSize: 7,
    color: T.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  kpiValue: { fontSize: 14, fontFamily: "JetBrains Mono", color: T.ink },
  badge: { fontSize: 7, marginTop: 4, fontFamily: "JetBrains Mono" },
  cols: { flexDirection: "row", gap: 18 },
  col: { flex: 1 },
  colHead: { fontSize: 9, fontFamily: "Fraunces", color: T.ink, marginBottom: 6 },
  catHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    marginBottom: 2,
  },
  catName: { fontSize: 8, color: T.ink, fontWeight: 600 },
  catTotal: { fontSize: 8, fontFamily: "JetBrains Mono", color: T.ink },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1.5,
    borderBottomWidth: 0.5,
    borderBottomColor: T.hair2,
  },
  rowName: { fontSize: 8, color: T.ink2, flex: 2 },
  rowVal: { fontSize: 8, fontFamily: "JetBrains Mono", color: T.ink2, flex: 1, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: T.accent,
  },
  totalLabel: { fontSize: 9, fontFamily: "Fraunces", color: T.ink },
  totalVal: { fontSize: 9, fontFamily: "JetBrains Mono", color: T.ink },
  empty: { fontSize: 8, color: T.ink3 },
  ooeHead: { fontSize: 9, fontFamily: "Fraunces", color: T.ink, marginTop: 16, marginBottom: 6 },
});

function Badge({ yoy }: { yoy: YoyResult | null }) {
  if (!yoy) return null;
  const color = yoy.badge === "up" ? T.good : yoy.badge === "down" ? T.crit : T.ink3;
  const arrow = yoy.badge === "up" ? "▲" : yoy.badge === "down" ? "▼" : "·";
  const sign = yoy.value > 0 ? "+" : "";
  return <Text style={[S.badge, { color }]}>{`${arrow} ${sign}${yoy.value.toFixed(1)}%`}</Text>;
}

function Kpi({
  label,
  value,
  yoy,
}: {
  label: string;
  value: number;
  yoy?: YoyResult | null;
}) {
  return (
    <View style={S.kpiCard}>
      <Text style={S.kpiLabel}>{label}</Text>
      <Text style={S.kpiValue}>{fmt(value)}</Text>
      {yoy !== undefined && <Badge yoy={yoy} />}
    </View>
  );
}

export function BalanceSheetPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: RenderPdfInput<BalanceSheetPageData>) {
  const vm = data.viewModel;
  const showOutOfEstate = data.showOutOfEstate && vm.outOfEstateOwnerRows.length > 0;
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title="Balance Sheet" subtitle={data.asOfLabel} accent={accent} />

      <View style={S.kpiRow}>
        <Kpi label="Net Worth" value={vm.netWorth} yoy={vm.yoy.netWorth} />
        <Kpi label="Total Assets" value={vm.totalAssets} yoy={vm.yoy.totalAssets} />
        <Kpi label="Total Liabilities" value={vm.totalLiabilities} yoy={vm.yoy.totalLiabilities} />
        <Kpi label="Liquid Portfolio" value={data.liquidPortfolio} />
      </View>

      <View style={S.cols}>
        <View style={S.col}>
          <Text style={S.colHead}>Assets</Text>
          {vm.assetCategories.map((cat) => (
            <View key={cat.key} wrap={false}>
              <View style={S.catHead}>
                <Text style={S.catName}>{cat.label}</Text>
                <Text style={S.catTotal}>{fmt(cat.total)}</Text>
              </View>
              {cat.rows.map((r) => (
                <View key={r.rowKey} style={S.row}>
                  <Text style={S.rowName}>
                    {r.accountName}
                    {r.hasLinkedMortgage ? " (M)" : ""}
                  </Text>
                  <Text style={S.rowVal}>{fmt(r.value)}</Text>
                </View>
              ))}
            </View>
          ))}
          <View style={S.totalRow}>
            <Text style={S.totalLabel}>Total Assets</Text>
            <Text style={S.totalVal}>{fmt(vm.totalAssets)}</Text>
          </View>
        </View>

        <View style={S.col}>
          <Text style={S.colHead}>Liabilities</Text>
          {vm.liabilityRows.length === 0 ? (
            <Text style={S.empty}>No liabilities.</Text>
          ) : (
            vm.liabilityRows.map((r) => (
              <View key={r.rowKey} style={S.row}>
                <Text style={S.rowName}>{r.liabilityName}</Text>
                <Text style={S.rowVal}>{fmt(r.balance)}</Text>
              </View>
            ))
          )}
          <View style={S.totalRow}>
            <Text style={S.totalLabel}>Total Liabilities</Text>
            <Text style={S.totalVal}>{fmt(vm.totalLiabilities)}</Text>
          </View>
          <View style={[S.totalRow, { borderTopColor: T.ink }]}>
            <Text style={S.totalLabel}>Net Worth</Text>
            <Text style={S.totalVal}>{fmt(vm.netWorth)}</Text>
          </View>

          {showOutOfEstate && (
            <View wrap={false}>
              <Text style={S.ooeHead}>Out of Estate</Text>
              {vm.outOfEstateOwnerRows.map((r) => (
                <View key={r.ownerKey} style={S.row}>
                  <Text style={S.rowName}>{r.ownerName}</Text>
                  <Text style={[S.rowVal, r.net < 0 ? { color: T.crit } : {}]}>{fmt(r.net)}</Text>
                </View>
              ))}
              <View style={S.totalRow}>
                <Text style={S.totalLabel}>Net Out of Estate</Text>
                <Text style={[S.totalVal, vm.outOfEstateNetWorth < 0 ? { color: T.crit } : {}]}>
                  {fmt(vm.outOfEstateNetWorth)}
                </Text>
              </View>
            </View>
          )}
        </View>
      </View>
    </PageFrame>
  );
}
