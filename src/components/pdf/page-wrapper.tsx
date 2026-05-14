// Wraps a single PDF page with paper-color background, gutter padding,
// and (when not the cover) the running header + footer.

import { Page, View, StyleSheet } from "@react-pdf/renderer";
import { PDF_THEME } from "./theme";
import { RunningHeader } from "./running-header";
import { RunningFooter } from "./running-footer";
import type { ReactNode } from "react";

const styles = StyleSheet.create({
  page: {
    backgroundColor: PDF_THEME.paper,
    color: PDF_THEME.ink,
    fontFamily: "Inter",
    paddingTop: 56,
    paddingBottom: 56,
    paddingLeft: 48,
    paddingRight: 48,
  },
});

export function ReportPage({
  orientation,
  isCover,
  householdName,
  reportTitle,
  reportYear,
  firmName,
  logoDataUrl,
  accentColor,
  pageIndex,
  totalPages,
  children,
}: {
  orientation: "portrait" | "landscape";
  isCover: boolean;
  householdName: string;
  reportTitle: string;
  reportYear: number;
  firmName: string;
  logoDataUrl: string | null;
  accentColor: string;
  pageIndex: number;
  totalPages: number;
  children: ReactNode;
}) {
  return (
    <Page size="LETTER" orientation={orientation} style={styles.page}>
      {!isCover && (
        <RunningHeader
          firmName={firmName}
          logoDataUrl={logoDataUrl}
          householdName={householdName}
          reportTitle={reportTitle}
          reportYear={reportYear}
        />
      )}
      <View style={{ flex: 1 }}>{children}</View>
      {!isCover && (
        <RunningFooter
          firmName={firmName}
          pageIndex={pageIndex}
          totalPages={totalPages}
          accentColor={accentColor}
        />
      )}
    </Page>
  );
}
