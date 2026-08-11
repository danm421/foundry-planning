import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME, type SectionAccent } from "@/lib/presentations/theme";
import type { MapNetWorthPageData } from "@/lib/presentations/pages/household-map/types";
import { PageFrame } from "../../shared/page-frame";
import { SectionHead } from "../../shared/section-head";
import { MapCardPdf, MapTrayPdf } from "../map-shared/card-pdf";

/**
 * The Net Worth board in print: ownership columns with running subtotals, a
 * tray for anything a trust, business or other family member owns, and the
 * household total.
 *
 * Landscape. The board is three columns of cards side by side, and portrait
 * letter leaves each ~170pt — narrower than a long account name plus its value,
 * so every card would wrap. Landscape gives each column ~230pt, which is what
 * the on-screen columns actually get.
 */
const styles = StyleSheet.create({
  personLine: {
    fontFamily: "Inter",
    fontSize: 9,
    color: PRESENTATION_THEME.ink2,
    textAlign: "center",
    marginBottom: 6,
  },
  columns: { flexDirection: "row", gap: 12 },
  column: { flex: 1 },
  // Takes the slack so every column's subtotal lands on ONE line, however few
  // cards a column holds. Without it a spouse with a single account has their
  // subtotal printed near the top of the page while the client's sits at the
  // bottom, and the three numbers a reader wants to compare are inches apart.
  columnCards: { flexGrow: 1 },
  columnHead: {
    fontFamily: "JetBrains Mono",
    fontSize: 7.5,
    letterSpacing: 0.5,
    color: PRESENTATION_THEME.ink2,
    textAlign: "center",
    borderBottomWidth: 1,
    paddingBottom: 3,
    marginBottom: 5,
  },
  columnFoot: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 5,
    borderTopWidth: 0.5,
    borderTopColor: PRESENTATION_THEME.hair2,
    paddingTop: 3,
    marginTop: 2,
  },
  footLabel: { fontFamily: "Inter", fontSize: 7, color: PRESENTATION_THEME.ink3 },
  footValue: {
    fontFamily: "JetBrains Mono",
    fontSize: 7.5,
    fontWeight: 700,
    color: PRESENTATION_THEME.ink,
  },
  // Tight on purpose. The household total is the last thing on the page and the
  // first thing to be orphaned onto a page of its own; every point of leading
  // above it buys a household that fits on one sheet.
  totalRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "baseline",
    gap: 8,
    marginTop: 5,
    borderTopWidth: 1.5,
    paddingTop: 4,
  },
  totalLabel: { fontFamily: "Inter", fontSize: 9, color: PRESENTATION_THEME.ink2 },
  totalValue: {
    fontFamily: "JetBrains Mono",
    fontSize: 12,
    fontWeight: 700,
    color: PRESENTATION_THEME.ink,
  },
});

export function MapNetWorthPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: {
  data: MapNetWorthPageData;
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  accent: SectionAccent;
}) {
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

      <View style={styles.columns}>
        {data.columns.map((col) => (
          <View key={col.key} style={styles.column}>
            <Text style={[styles.columnHead, { borderBottomColor: accent.accent }]}>
              {col.label.toUpperCase()}
            </Text>
            <View style={styles.columnCards}>
              {col.cards.map((c) => (
                <MapCardPdf key={c.id} item={c} />
              ))}
            </View>
            <View style={styles.columnFoot}>
              <Text style={styles.footLabel}>{col.label}</Text>
              <Text style={styles.footValue}>{col.subtotalLabel}</Text>
            </View>
          </View>
        ))}
      </View>

      {data.tray && <MapTrayPdf label={data.tray.label} cards={data.tray.cards} />}

      {/* `wrap={false}`: without it react-pdf splits the row at its rule and
          prints the accent line at the foot of one page and the household
          total at the head of the next. */}
      <View style={[styles.totalRow, { borderTopColor: accent.accent }]} wrap={false}>
        <Text style={styles.totalLabel}>{data.totalLabel}</Text>
        <Text style={styles.totalValue}>{data.totalValueLabel}</Text>
      </View>
    </PageFrame>
  );
}
