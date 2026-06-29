import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { ScenarioChangesPageData, ChangeRow, DisplayUnit } from "@/lib/presentations/pages/scenario-changes/types";
import type { RenderPdfInput } from "@/components/presentations/registry";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";

const COL = { area: 70, change: 78 } as const;

const styles = StyleSheet.create({
  table: { marginTop: 6 },
  headerRow: {
    flexDirection: "row",
    backgroundColor: PRESENTATION_THEME.card,
    borderBottomWidth: 1,
    borderBottomColor: PRESENTATION_THEME.accent,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  row: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: PRESENTATION_THEME.hair2,
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  th: { fontFamily: "Inter", fontSize: 6.5, fontWeight: 700, color: PRESENTATION_THEME.ink3, paddingHorizontal: 3 },
  area: { fontFamily: "Inter", fontSize: 6.5, fontWeight: 700, color: PRESENTATION_THEME.accent, paddingHorizontal: 3 },
  what: { fontFamily: "Inter", fontSize: 8, fontWeight: 600, color: PRESENTATION_THEME.ink, paddingHorizontal: 3 },
  change: { fontFamily: "JetBrains Mono", fontSize: 7.5, color: PRESENTATION_THEME.ink3, paddingHorizontal: 3 },
  changeGood: { fontWeight: 600, color: PRESENTATION_THEME.good },
  changeRemoved: { fontWeight: 600, color: PRESENTATION_THEME.crit },
  detailWrap: { flex: 2.4, paddingHorizontal: 3 },
  detailLine: { fontFamily: "Inter", fontSize: 7.5, color: PRESENTATION_THEME.ink2, lineHeight: 1.35 },
  band: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PRESENTATION_THEME.accentTint,
    paddingVertical: 4,
    paddingHorizontal: 4,
    marginTop: 4,
  },
  pill: {
    fontFamily: "Inter", fontSize: 6, fontWeight: 700, color: PRESENTATION_THEME.card,
    backgroundColor: PRESENTATION_THEME.accent, paddingVertical: 1.5, paddingHorizontal: 4, borderRadius: 2, marginRight: 6,
  },
  bandName: { fontFamily: "Inter", fontSize: 7.5, fontWeight: 700, color: PRESENTATION_THEME.ink },
  memberIndent: { paddingLeft: 14 },
  empty: { marginTop: 40, fontFamily: "Fraunces", fontSize: 13, color: PRESENTATION_THEME.ink2, textAlign: "center" },
  flexWhat: { flex: 1.6 },
  flexWhatWide: { flex: 4 },
});

function HeaderRow({ showDetails }: { showDetails: boolean }) {
  return (
    <View style={styles.headerRow} fixed>
      <Text style={[styles.th, { width: COL.area }]}>AREA</Text>
      <Text style={[styles.th, showDetails ? styles.flexWhat : styles.flexWhatWide]}>WHAT CHANGED</Text>
      <Text style={[styles.th, { width: COL.change }]}>CHANGE</Text>
      {showDetails && <Text style={[styles.th, styles.detailWrap]}>DETAILS</Text>}
    </View>
  );
}

function ChangeCell({ row }: { row: ChangeRow }) {
  const showBefore = row.op === "edit" && row.before !== "—";
  if (showBefore) {
    return (
      <Text style={[styles.change, { width: COL.change }]}>
        {row.before} → {row.after}
      </Text>
    );
  }
  const tone = row.op === "remove" ? styles.changeRemoved : styles.changeGood;
  return <Text style={[styles.change, tone, { width: COL.change }]}>{row.after}</Text>;
}

function Row({ row, showDetails, indent }: { row: ChangeRow; showDetails: boolean; indent?: boolean }) {
  return (
    <View style={styles.row} wrap={false}>
      <Text style={[styles.area, { width: COL.area }]}>{row.area}</Text>
      <Text style={[styles.what, showDetails ? styles.flexWhat : styles.flexWhatWide, ...(indent ? [styles.memberIndent] : [])]}>
        {indent ? `↳ ${row.what}` : row.what}
      </Text>
      <ChangeCell row={row} />
      {showDetails && row.detail.length > 0 && (
        <View style={styles.detailWrap}>
          {row.detail.map((line, i) => (
            <Text key={i} style={styles.detailLine}>{line}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

function GroupBand({ label }: { label: string }) {
  return (
    <View style={styles.band} wrap={false}>
      <Text style={styles.pill}>STRATEGY</Text>
      <Text style={styles.bandName}>{label}</Text>
    </View>
  );
}

export function ScenarioChangesPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: RenderPdfInput<ScenarioChangesPageData>) {
  return (
    <PageFrame firmName={firmName} clientName={clientName} reportDate={reportDate} pageIndex={pageIndex} totalPages={totalPages}>
      <SectionHead title={data.title} subtitle={data.subtitle || undefined} eyebrow="SCENARIO CHANGES" accent={accent} />
      {data.isEmpty ? (
        <Text style={styles.empty}>This scenario matches the base plan — there are no changes to show.</Text>
      ) : (
        <View style={styles.table}>
          <HeaderRow showDetails={data.showExplanations} />
          {data.units.map((unit: DisplayUnit, i) =>
            unit.kind === "row" ? (
              <Row key={`r${i}`} row={unit.row} showDetails={data.showExplanations} />
            ) : (
              <View key={`g${i}`}>
                <GroupBand label={unit.label} />
                {unit.rows.map((r, j) => (
                  <Row key={`g${i}-${j}`} row={r} showDetails={data.showExplanations} indent />
                ))}
              </View>
            ),
          )}
        </View>
      )}
    </PageFrame>
  );
}
