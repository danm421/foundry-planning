import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { BalanceSheetPageData } from "@/lib/presentations/pages/balance-sheet/view-model";
import { exactCurrency as fmt } from "@/lib/presentations/format";
import { prepareEntityGroups } from "@/lib/balance-sheet/entity-groups";

const ENTITY_TYPE_LABEL: Record<string, string> = {
  trust: "Trust",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  sole_prop: "Sole Prop",
  foundation: "Foundation",
  other: "Entity",
};

const S = StyleSheet.create({
  card: {
    borderWidth: 0.5,
    borderColor: T.hair2,
    borderRadius: 4,
    padding: 12,
    marginBottom: 12,
    backgroundColor: T.card,
  },
  cardHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    marginBottom: 4,
  },
  entityName: { fontSize: 11, fontFamily: "Fraunces", color: T.ink },
  chip: {
    fontSize: 7,
    fontFamily: "JetBrains Mono",
    color: T.accent,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  subHead: {
    fontSize: 7,
    color: T.ink3,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginTop: 6,
    marginBottom: 2,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 1.5,
    borderBottomWidth: 0.5,
    borderBottomColor: T.hair2,
  },
  rowName: { fontSize: 8, color: T.ink2, flex: 2 },
  rowVal: { fontSize: 8, fontFamily: "JetBrains Mono", color: T.ink2, flex: 1, textAlign: "right" },
  none: { fontSize: 8, color: T.ink3 },
  netRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: T.accent,
  },
  netLabel: { fontSize: 9, fontFamily: "Fraunces", color: T.ink },
  netVal: { fontSize: 9, fontFamily: "JetBrains Mono", color: T.ink },
  empty: { fontSize: 9, color: T.ink3, marginTop: 12 },
});

export function EntitiesBalanceSheetPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: RenderPdfInput<BalanceSheetPageData>) {
  const groups = prepareEntityGroups(data.viewModel.entityGroups ?? []);
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title="Balance Sheet — Entities" subtitle={data.asOfLabel} accent={accent} />

      {groups.length === 0 ? (
        <Text style={S.empty}>No entities for this household.</Text>
      ) : (
        groups.map((g) => (
          <View key={g.entityId} style={S.card} wrap={false}>
            <View style={S.cardHead}>
              <Text style={S.entityName}>{g.entityName}</Text>
              <Text style={S.chip}>{ENTITY_TYPE_LABEL[g.entityType] ?? "Entity"}</Text>
            </View>

            <Text style={S.subHead}>Assets</Text>
            {g.assetRows.length === 0 ? (
              <Text style={S.none}>None</Text>
            ) : (
              g.assetRows.map((r) => (
                <View key={r.rowKey} style={S.row}>
                  <Text style={S.rowName}>{r.accountName}</Text>
                  <Text style={S.rowVal}>{fmt(r.value)}</Text>
                </View>
              ))
            )}

            {g.liabilityRows.length > 0 && (
              <>
                <Text style={S.subHead}>Liabilities</Text>
                {g.liabilityRows.map((r) => (
                  <View key={r.rowKey} style={S.row}>
                    <Text style={S.rowName}>{r.liabilityName}</Text>
                    <Text style={S.rowVal}>{fmt(r.balance)}</Text>
                  </View>
                ))}
              </>
            )}

            <View style={S.netRow}>
              <Text style={S.netLabel}>Net Worth</Text>
              <Text style={S.netVal}>{fmt(g.netWorth)}</Text>
            </View>
          </View>
        ))
      )}
    </PageFrame>
  );
}
