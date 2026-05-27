import { Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
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
    height: 0.5,
    backgroundColor: PRESENTATION_THEME.hair,
    marginBottom: 6,
  },
  footerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7,
    color: PRESENTATION_THEME.ink3,
  },
});

export function PageFrame({
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  children,
}: {
  firmName: string;
  clientName: string;
  reportDate: string;
  pageIndex: number;
  totalPages: number;
  children: ReactNode;
}) {
  return (
    <Page size="LETTER" orientation="portrait" style={styles.page}>
      <View style={styles.headerRow}>
        <Text>{firmName}</Text>
        <Text>{`${clientName}  ·  ${reportDate}`}</Text>
      </View>
      <View style={styles.headerAccentRule} />
      <View style={styles.body}>{children}</View>
      <View style={styles.footerHair} />
      <View style={styles.footerRow}>
        <Text>Confidential · Personal</Text>
        <Text>{`Page ${pageIndex} of ${totalPages}`}</Text>
      </View>
    </Page>
  );
}
