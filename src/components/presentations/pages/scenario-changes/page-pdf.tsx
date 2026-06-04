import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Style } from "@react-pdf/types";
import type { ScenarioChangesPageData, ChangeRow, DisplayUnit } from "@/lib/presentations/pages/scenario-changes/types";
import type { RenderPdfInput } from "@/components/presentations/registry";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";

const COL = { area: 70, before: 60, after: 66 } as const;

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
    borderBottomColor: PRESENTATION_THEME.hair,
    paddingVertical: 5,
    paddingHorizontal: 2,
  },
  th: { fontFamily: "Inter", fontSize: 6.5, fontWeight: 700, color: PRESENTATION_THEME.ink3, paddingHorizontal: 3 },
  area: { fontFamily: "Inter", fontSize: 6.5, fontWeight: 700, color: PRESENTATION_THEME.accent, paddingHorizontal: 3 },
  what: { fontFamily: "Inter", fontSize: 8, fontWeight: 600, color: PRESENTATION_THEME.ink, paddingHorizontal: 3 },
  before: { fontFamily: "JetBrains Mono", fontSize: 7.5, color: PRESENTATION_THEME.ink3, paddingHorizontal: 3 },
  after: { fontFamily: "JetBrains Mono", fontSize: 7.5, fontWeight: 600, color: PRESENTATION_THEME.good, paddingHorizontal: 3 },
  afterRemoved: { color: PRESENTATION_THEME.crit },
  why: { fontFamily: "Inter", fontSize: 7.5, color: PRESENTATION_THEME.ink2, lineHeight: 1.35, paddingHorizontal: 3 },
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
  flexWhat: { flex: 1.4 },
  flexWhy: { flex: 2.2 },
});

function HeaderRow({ showExplanations }: { showExplanations: boolean }) {
  return (
    <View style={styles.headerRow} fixed>
      <Text style={[styles.th, { width: COL.area }]}>AREA</Text>
      <Text style={[styles.th, styles.flexWhat]}>WHAT CHANGED</Text>
      <Text style={[styles.th, { width: COL.before }]}>BEFORE</Text>
      <Text style={[styles.th, { width: COL.after }]}>AFTER</Text>
      {showExplanations && <Text style={[styles.th, styles.flexWhy]}>WHY IT MATTERS</Text>}
    </View>
  );
}

function Row({ row, showExplanations, indent }: { row: ChangeRow; showExplanations: boolean; indent?: boolean }) {
  const afterStyle: Style[] = [styles.after];
  if (row.op === "remove") afterStyle.push(styles.afterRemoved);
  return (
    <View style={styles.row} wrap={false}>
      <Text style={[styles.area, { width: COL.area }]}>{row.area}</Text>
      <Text style={[styles.what, styles.flexWhat, ...(indent ? [styles.memberIndent] : [])]}>
        {indent ? `↳ ${row.what}` : row.what}
      </Text>
      <Text style={[styles.before, { width: COL.before }]}>{row.before}</Text>
      <Text style={[...afterStyle, { width: COL.after }]}>{row.after}</Text>
      {showExplanations && <Text style={[styles.why, styles.flexWhy]}>{row.why}</Text>}
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
          <HeaderRow showExplanations={data.showExplanations} />
          {data.units.map((unit: DisplayUnit, i) =>
            unit.kind === "row" ? (
              <Row key={`r${i}`} row={unit.row} showExplanations={data.showExplanations} />
            ) : (
              <View key={`g${i}`}>
                <GroupBand label={unit.label} />
                {unit.rows.map((r, j) => (
                  <Row key={`g${i}-${j}`} row={r} showExplanations={data.showExplanations} indent />
                ))}
              </View>
            ),
          )}
        </View>
      )}
    </PageFrame>
  );
}
