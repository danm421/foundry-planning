// Wraps an artifact's view-blocks into a complete @react-pdf/renderer Document.

import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { ensureFontsRegistered } from "./fonts";
import { ReportPage } from "./page-wrapper";
import { PDF_THEME } from "./theme";

ensureFontsRegistered();

export type ArtifactDocumentProps = {
  householdName: string;
  artifactTitle: string;
  reportYear: number;
  firmName: string;
  asOf: Date;
  children: ReactNode; // view-blocks returned by artifact.renderPdf
  showCover?: boolean;
};

const s = StyleSheet.create({
  coverPage: {
    backgroundColor: PDF_THEME.paper,
    color: PDF_THEME.ink,
    fontFamily: "Inter",
    paddingTop: 56,
    paddingBottom: 56,
    paddingLeft: 48,
    paddingRight: 48,
  },
  coverBody: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  coverTitle: {
    fontSize: 28,
    fontWeight: 700,
    color: PDF_THEME.ink,
    marginTop: 24,
  },
  coverSub: {
    fontSize: 14,
    color: PDF_THEME.ink2,
    marginTop: 12,
  },
  titleBlock: {
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: PDF_THEME.ink,
  },
  subtitle: {
    fontSize: 11,
    marginTop: 4,
    color: PDF_THEME.ink2,
  },
});

const formatDate = (d: Date) =>
  d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

export function ArtifactDocument({
  householdName,
  artifactTitle,
  reportYear,
  firmName,
  asOf,
  children,
  showCover = false,
}: ArtifactDocumentProps) {
  // Cover is page 0; content starts at page 1 when cover is shown.
  const contentPageIndex = showCover ? 1 : 0;
  // Single-content-page for Plan 1; Plan 3 will extend when concatenating.
  const totalPages = showCover ? 2 : 1;

  return (
    <Document>
      {showCover && (
        <Page size="LETTER" style={s.coverPage}>
          <View style={s.coverBody}>
            <Text style={s.coverTitle}>{householdName}</Text>
            <Text style={s.coverSub}>{artifactTitle}</Text>
            <Text style={s.coverSub}>As of {formatDate(asOf)}</Text>
          </View>
        </Page>
      )}
      <ReportPage
        orientation="portrait"
        isCover={false}
        householdName={householdName}
        reportTitle={artifactTitle}
        reportYear={reportYear}
        firmName={firmName}
        pageIndex={contentPageIndex}
        totalPages={totalPages}
      >
        <View style={s.titleBlock}>
          <Text style={s.title}>{artifactTitle}</Text>
          <Text style={s.subtitle}>As of {formatDate(asOf)}</Text>
        </View>
        {children}
      </ReportPage>
    </Document>
  );
}
