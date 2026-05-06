// src/components/reports-pdf/page-wrapper.tsx
//
// Wraps a single PDF page with paper-color background, gutter padding,
// and (when not the cover) the running header + footer.
//
// Padding budget (non-cover):
//   * header band (~24pt) + accent underline (1.5pt) + spacer (16pt)
//     ≈ 42pt of header chrome, paid by RunningHeader itself.
//   * page paddingTop adds 8pt above the band so the header doesn't
//     hug the top edge — total ~50pt before content begins.
//   * paddingBottom of 56pt leaves room for the footer (~32pt above
//     the bottom edge with hair rule + text row).
//
// For the cover page, all padding is stripped and the background is
// flipped to `inkDeep` so the CoverPdfRender can paint a full-bleed
// dark sheet with edge-to-edge accent rules.

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
    paddingTop: 8,
    paddingBottom: 56,
    paddingLeft: 48,
    paddingRight: 48,
  },
  coverPage: {
    backgroundColor: PDF_THEME.inkDeep,
    color: PDF_THEME.inkOnDark,
    fontFamily: "Inter",
    padding: 0,
  },
});

export function ReportPage({
  orientation,
  isCover,
  householdName,
  reportTitle,
  reportYear,
  firmName,
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
  pageIndex: number;
  totalPages: number;
  children: ReactNode;
}) {
  return (
    <Page
      size="LETTER"
      orientation={orientation}
      style={isCover ? styles.coverPage : styles.page}
    >
      {!isCover && (
        <RunningHeader
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
        />
      )}
    </Page>
  );
}
