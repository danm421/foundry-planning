import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T, type SectionAccent } from "@/lib/presentations/theme";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";
import type { EstateFlowChartData } from "@/lib/presentations/pages/estate-flow-chart/view-model";
import type {
  DeathStage,
  DeathSubBoxKind,
  EstateFlowSummary,
  HeirBox,
} from "@/lib/estate/estate-flow-summary";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const SUBBOX_COLOR: Record<DeathSubBoxKind, string> = {
  taxes: T.crit,
  trusts: T.ink2,
  inheritance_spouse: T.steel,
  heirs_outright: T.good,
};

const styles = StyleSheet.create({
  totalsRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  totalBox: { flex: 1, borderRadius: 4, padding: 10 },
  totalLabel: { fontSize: 7, color: T.card, textTransform: "uppercase", letterSpacing: 1 },
  totalValue: { fontSize: 15, color: T.card, fontFamily: "Inter", marginTop: 3 },
  mainRow: { flexDirection: "row", gap: 10 },
  spine: { flex: 2, gap: 6 },
  rail: { flex: 1, gap: 6 },
  railHead: { fontSize: 7, color: T.ink3, textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 },
  estateBox: { borderRadius: 4, padding: 8, backgroundColor: T.accent },
  estateLabel: { fontSize: 8, color: T.card, textTransform: "uppercase", letterSpacing: 0.5 },
  estateValue: { fontSize: 13, color: T.card, marginTop: 2 },
  subBox: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 3,
    padding: 6,
  },
  subLabel: { fontSize: 8, color: T.card },
  subValue: { fontSize: 8, color: T.card },
  chevron: { fontSize: 9, color: T.ink3, textAlign: "center" },
  ooeBox: { borderRadius: 4, padding: 8, borderWidth: 1, borderColor: T.hair2, backgroundColor: T.card },
  ooeLabel: { fontSize: 7, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5 },
  ooeValue: { fontSize: 11, color: T.ink, marginTop: 2 },
  survivorBox: { borderRadius: 4, padding: 8, borderWidth: 1, borderColor: T.steel, backgroundColor: T.card, marginBottom: 6 },
  heirsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
  heirBox: { width: "31%", borderRadius: 4, borderWidth: 1, borderColor: T.good, padding: 8 },
  heirName: { fontSize: 9, color: T.ink, fontFamily: "Inter" },
  heirRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  heirRowLabel: { fontSize: 7, color: T.ink2 },
  heirRowValue: { fontSize: 7, color: T.ink },
  heirTotalRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 3, borderTopWidth: 0.5, borderTopColor: T.hair2, paddingTop: 2 },
  heirTotalLabel: { fontSize: 8, color: T.ink, fontFamily: "Inter" },
  detailLine: { flexDirection: "row", justifyContent: "space-between", marginTop: 1 },
  detailLabel: { fontSize: 6, color: T.ink3 },
  empty: { fontSize: 10, color: T.ink3, marginTop: 40, textAlign: "center" },
});

function Chevron() {
  return <Text style={styles.chevron}>▼</Text>;
}

function DeathSpine({ stage }: { stage: DeathStage }) {
  return (
    <>
      <View style={styles.estateBox}>
        <Text style={styles.estateLabel}>{stage.decedentLabel} · {stage.year}</Text>
        <Text style={styles.estateValue}>{fmt.format(stage.estateValue)}</Text>
      </View>
      {stage.subBoxes.length > 0 && <Chevron />}
      {stage.subBoxes.map((box, i) => (
        <View key={i} style={[styles.subBox, { backgroundColor: SUBBOX_COLOR[box.kind] }]}>
          <Text style={styles.subLabel}>{box.label}</Text>
          <Text style={styles.subValue}>{fmt.format(box.total)}</Text>
        </View>
      ))}
    </>
  );
}

function HeirCard({ heir, showDetail }: { heir: HeirBox; showDetail: boolean }) {
  return (
    <View style={styles.heirBox} wrap={false}>
      <Text style={styles.heirName}>{heir.recipientLabel}</Text>
      <View style={styles.heirRow}>
        <Text style={styles.heirRowLabel}>Outright</Text>
        <Text style={styles.heirRowValue}>{fmt.format(heir.outright)}</Text>
      </View>
      <View style={styles.heirRow}>
        <Text style={styles.heirRowLabel}>In Trust</Text>
        <Text style={styles.heirRowValue}>{fmt.format(heir.inTrust)}</Text>
      </View>
      {showDetail &&
        heir.sections.map((s, si) => (
          <View key={si}>
            <Text style={[styles.heirRowLabel, { marginTop: 3 }]}>{s.title}</Text>
            {s.lines.map((l, li) => (
              <View key={li} style={styles.detailLine}>
                <Text style={styles.detailLabel}>{l.label}</Text>
                <Text style={styles.detailLabel}>{fmt.format(l.amount)}</Text>
              </View>
            ))}
          </View>
        ))}
      <View style={styles.heirTotalRow}>
        <Text style={styles.heirTotalLabel}>Total</Text>
        <Text style={styles.heirTotalLabel}>{fmt.format(heir.total)}</Text>
      </View>
    </View>
  );
}

export function EstateFlowChartPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: EstateFlowChartData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  const s: EstateFlowSummary | null = data.summary;
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />
      {!s ? (
        <Text style={styles.empty}>No estate data available for this scenario.</Text>
      ) : (
        <>
          <View style={styles.totalsRow}>
            <View style={[styles.totalBox, { backgroundColor: T.crit }]}>
              <Text style={styles.totalLabel}>Total Taxes & Expenses</Text>
              <Text style={styles.totalValue}>
                {fmt.format(s.totals.totalTaxesAndExpenses)}
              </Text>
            </View>
            <View style={[styles.totalBox, { backgroundColor: T.good }]}>
              <Text style={styles.totalLabel}>Total to Heirs</Text>
              <Text style={styles.totalValue}>{fmt.format(s.totals.totalToHeirs)}</Text>
            </View>
          </View>

          <View style={styles.mainRow}>
            <View style={styles.spine}>
              {s.survivorNetWorth && (
                <View style={styles.survivorBox}>
                  <Text style={styles.ooeLabel}>
                    {s.survivorNetWorth.ownerLabel} — Net Worth
                  </Text>
                  <Text style={styles.ooeValue}>{fmt.format(s.survivorNetWorth.amount)}</Text>
                </View>
              )}
              {s.firstDeath && <DeathSpine stage={s.firstDeath} />}
              {s.firstDeath && s.secondDeath && <Chevron />}
              {s.secondDeath && <DeathSpine stage={s.secondDeath} />}
            </View>

            <View style={styles.rail}>
              <Text style={styles.railHead}>Out of Estate</Text>
              {[...s.outOfEstate.irrevTrusts.entities, ...s.outOfEstate.heirs.entities].map(
                (e) => (
                  <View key={e.entityId} style={styles.ooeBox}>
                    <Text style={styles.ooeLabel}>{e.entityLabel}</Text>
                    <Text style={styles.ooeValue}>{fmt.format(e.amount)}</Text>
                  </View>
                ),
              )}
              {s.outOfEstate.irrevTrusts.entities.length === 0 &&
                s.outOfEstate.heirs.entities.length === 0 && (
                  <View style={styles.ooeBox}>
                    <Text style={styles.ooeLabel}>None</Text>
                  </View>
                )}
            </View>
          </View>

          {s.heirBoxes.length > 0 && (
            <View style={styles.heirsWrap}>
              {s.heirBoxes.map((h) => (
                <HeirCard key={h.recipientKey} heir={h} showDetail={data.showHeirDetail} />
              ))}
            </View>
          )}
        </>
      )}
    </PageFrame>
  );
}
