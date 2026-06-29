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
    paddingBottom: 42,
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
      <View style={styles.footerHair} fixed />
      <Text style={styles.footerDisclaimer} fixed>
        {SHORT_DISCLAIMER}
      </Text>
      <View style={styles.footerRow} fixed>
        <Text>Confidential · Personal</Text>
        <Text render={({ pageNumber, totalPages: tp }) => `Page ${pageNumber} of ${tp}`} />
      </View>
    </Page>
  );
}
