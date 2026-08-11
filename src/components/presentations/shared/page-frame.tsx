import { Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { SHORT_DISCLAIMER } from "@/lib/presentations/disclaimers";
import type { ReactNode } from "react";

const styles = StyleSheet.create({
  page: {
    backgroundColor: PRESENTATION_THEME.paper,
    color: PRESENTATION_THEME.ink,
    fontFamily: "Inter",
    paddingTop: 54,
    // 42pt of true bottom margin PLUS the ~30pt the footer band occupies. The
    // footer is positioned absolutely (below), so it takes no space in the flow
    // and this padding is the ONLY thing keeping flowing content out of it —
    // see `footer`.
    paddingBottom: 72,
    paddingLeft: 43,
    paddingRight: 43,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    fontSize: 8,
    color: PRESENTATION_THEME.ink2,
  },
  headerAccentRule: {
    marginTop: 6,
    height: 1.5,
    backgroundColor: PRESENTATION_THEME.accent,
  },
  body: { flex: 1, marginTop: 14 },
  // Out of the flow, pinned 42pt off the paper's bottom edge — the same place
  // it printed when it was a flow sibling of `body`.
  //
  // It has to leave the flow. A `fixed` element repeats on every page, but
  // react-pdf breaks a page on the PAGE's content box, not on where that
  // element's one measured slot happens to sit: a card that fits above the
  // bottom padding but below the footer's top gets drawn straight through the
  // disclaimer. That is not hypothetical — the Household Map's Net Worth page
  // printed an account card over the disclaimer on any household with a long
  // enough ownership column. Absolute + the matching `paddingBottom` above is
  // the react-pdf recipe for a repeating footer, and the padding is what
  // actually reserves the band.
  //
  // `left`/`right` are re-applied because an absolutely positioned child is
  // placed against the page box, not inside its horizontal padding.
  footer: { position: "absolute", bottom: 42, left: 43, right: 43 },
  footerHair: {
    height: 0.75,
    backgroundColor: PRESENTATION_THEME.hair2,
    marginBottom: 6,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: PRESENTATION_THEME.ink3,
  },
  footerDisclaimer: {
    fontSize: 7.5,
    color: PRESENTATION_THEME.ink3,
    textAlign: "center",
    marginBottom: 4,
  },
});

export function PageFrame({
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  orientation = "portrait",
  children,
}: {
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  orientation?: "portrait" | "landscape";
  children: ReactNode;
}) {
  return (
    <Page size="LETTER" orientation={orientation} style={styles.page}>
      <View style={styles.headerRow}>
        <Text>{firmName}</Text>
        <Text>{`${clientName}  ·  ${reportDate}`}</Text>
      </View>
      <View style={styles.headerAccentRule} />
      <View style={styles.body}>{children}</View>
      <View style={styles.footer} fixed>
        <View style={styles.footerHair} />
        <Text style={styles.footerDisclaimer}>{SHORT_DISCLAIMER}</Text>
        <View style={styles.footerRow}>
          <Text>Confidential · Personal</Text>
          <Text render={({ pageNumber, totalPages: tp }) => `Page ${pageNumber} of ${tp}`} />
        </View>
      </View>
    </Page>
  );
}
