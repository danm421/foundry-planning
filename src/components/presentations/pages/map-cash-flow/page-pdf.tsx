import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";
import type { MapCashFlowPageData } from "@/lib/presentations/pages/household-map/types";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";
import { MapCardPdf, MapTrayPdf } from "../map-shared/card-pdf";

/**
 * The Cash Flow board in print: three bands (Income / Savings / Expenses) each
 * crossed with the owner columns, band subtotals, and the arithmetic of the
 * three.
 *
 * Landscape, and a fixed 62pt gutter for the band label, mirroring the board's
 * own `grid-cols-[100px_repeat(3,…)]`. The gutter has to be a fixed width
 * rather than a flex share or "EXPENSES" and "INCOME" would sit under different
 * left edges and the columns would step across the page band by band.
 *
 * Each card keeps its start/end year range — the one piece of information the
 * screen puts in a hover tooltip that a printed page has to state outright.
 */
const styles = StyleSheet.create({
  personLine: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PRESENTATION_THEME.ink2,
    textAlign: "center",
    marginBottom: 6,
  },
  personRow: { flexDirection: "row", gap: 8, marginBottom: 6, alignItems: "flex-end" },
  gutter: { width: 62 },
  columnHead: {
    flex: 1,
    fontFamily: "JetBrains Mono",
    fontSize: 7.5,
    letterSpacing: 0.5,
    color: PRESENTATION_THEME.ink2,
    textAlign: "center",
    borderBottomWidth: 1,
    paddingBottom: 3,
  },
  band: { marginBottom: 5 },
  bandRow: { flexDirection: "row", gap: 8 },
  bandLabel: {
    fontFamily: "JetBrains Mono",
    fontSize: 7.5,
    letterSpacing: 0.5,
    color: PRESENTATION_THEME.ink2,
    paddingTop: 4,
  },
  column: { flex: 1 },
  empty: {
    fontFamily: "Inter",
    fontSize: 7,
    color: PRESENTATION_THEME.ink3,
    textAlign: "center",
    paddingVertical: 5,
  },
  bandFoot: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 5,
    borderTopWidth: 0.5,
    borderTopColor: PRESENTATION_THEME.hair2,
    paddingTop: 2,
    marginTop: 1,
  },
  footLabel: { fontFamily: "Inter", fontSize: 7, color: PRESENTATION_THEME.ink3 },
  footValue: {
    fontFamily: "JetBrains Mono",
    fontSize: 7.5,
    fontWeight: 700,
    color: PRESENTATION_THEME.ink,
  },
  // The rule standing in for a subtotal. Same size and weight as `footValue` so
  // it holds the slot, but Inter rather than the mono face — mono is this
  // deck's tell for a figure, and "IRS max" set in it reads as one.
  footRule: {
    fontFamily: "Inter",
    fontSize: 7.5,
    fontWeight: 700,
    color: PRESENTATION_THEME.ink,
  },
  netRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "baseline",
    gap: 8,
    marginTop: 4,
    borderTopWidth: 1.5,
    paddingTop: 4,
  },
  netLabel: { fontFamily: "Inter", fontSize: 9, color: PRESENTATION_THEME.ink2 },
  netValue: {
    fontFamily: "JetBrains Mono",
    fontSize: 12,
    fontWeight: 700,
    color: PRESENTATION_THEME.ink,
  },
  unresolvedNote: {
    fontFamily: "Inter",
    fontSize: 7,
    color: PRESENTATION_THEME.ink3,
    textAlign: "right",
    marginTop: 4,
  },
});

/** An em dash where a total would be. Its own component so the withheld band
 *  subtotal and the withheld net read identically — a reader who meets one
 *  recognises the other. */
const WITHHELD = "—";

export function MapCashFlowPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: MapCashFlowPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
  const columnLabels = data.bands[0]?.columns ?? [];
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
      orientation="landscape"
    >
      <SectionHead title={data.title} subtitle={data.subtitle} accent={accent} />

      {data.personLine ? <Text style={styles.personLine}>{data.personLine}</Text> : null}

      <View style={styles.personRow}>
        {/* Empty spacer, not a label. The band-label gutter has to be reserved
            in the header row too or the column heads sit left of the columns
            they head. */}
        <View style={styles.gutter} />
        {columnLabels.map((col) => (
          <Text
            key={col.key}
            style={[styles.columnHead, { borderBottomColor: accent.accent }]}
          >
            {col.label.toUpperCase()}
          </Text>
        ))}
      </View>

      {data.bands.map((band) => (
        <View key={band.key} style={styles.band}>
          <View style={styles.bandRow}>
            <Text style={[styles.gutter, styles.bandLabel]}>{band.label.toUpperCase()}</Text>
            {band.columns.map((col) => (
              <View key={col.key} style={styles.column}>
                {col.cards.length === 0 ? (
                  <Text style={styles.empty}>—</Text>
                ) : (
                  col.cards.map((c) => <MapCardPdf key={c.id} item={c} showTiming />)
                )}
              </View>
            ))}
          </View>
          {band.tray && <MapTrayPdf label={band.tray.label} cards={band.tray.cards} showTiming />}
          <View style={styles.bandFoot}>
            <Text style={styles.footLabel}>{band.label}</Text>
            {/* A rule where the dollars would be — "IRS max" — set in the same
                slot and weight as a subtotal, because it answers the same
                question. It is prose, not a figure, so it drops the mono face
                the money uses; the em dash survives only as the impossible
                case, where a band is withheld and names no rule. */}
            {band.subtotalLabel !== null ? (
              <Text style={styles.footValue}>{band.subtotalLabel}</Text>
            ) : (
              <Text style={styles.footRule}>{band.subtotalRuleLabel ?? WITHHELD}</Text>
            )}
          </View>
          {/* Under the band that withholds its subtotal, not at the foot of the
              page: this is where a reader first meets the em dash, and it is
              the only band that can produce one. */}
          {band.subtotalLabel === null && data.unresolvedNote ? (
            <Text style={styles.unresolvedNote}>{data.unresolvedNote}</Text>
          ) : null}
        </View>
      ))}

      {/* `wrap={false}`: without it react-pdf splits the row at its rule and
          prints the accent line at the foot of one page and the figure at the
          head of the next. */}
      <View style={[styles.netRow, { borderTopColor: accent.accent }]} wrap={false}>
        <Text style={styles.netLabel}>{data.netLabel}</Text>
        <Text style={styles.netValue}>{data.netValueLabel ?? WITHHELD}</Text>
      </View>
    </PageFrame>
  );
}
