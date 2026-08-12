import { Fragment } from "react";
import { Text, View, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { PlanStoryPageData } from "@/lib/presentations/pages/plan-story/view-model";
import { PlanStoryChapterPdf } from "./chapter-pdf";

const styles = StyleSheet.create({
  emptyWrap: { paddingTop: 40 },
  emptyEyebrow: {
    fontFamily: "JetBrains Mono",
    fontSize: 9,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 8,
  },
  empty: { fontSize: 11, color: PRESENTATION_THEME.ink3, textAlign: "center" },
});

/**
 * The report's own name and the plan it narrates, for the top of every chapter.
 *
 * `subtitle` is the STORY's scenario label rather than the deck's, chosen in the
 * view-model precisely so this line cannot head a page "Proposed" over Base Case
 * prose. It only carries that meaning if it prints.
 */
function eyebrowOf(data: PlanStoryPageData): string {
  return [data.title, data.subtitle]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("  ·  ");
}

export function PlanStoryPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: RenderPdfInput<PlanStoryPageData>) {
  const eyebrow = eyebrowOf(data);

  if (data.isEmpty) {
    return (
      <PageFrame
        firmName={firmName}
        clientName={clientName}
        reportDate={reportDate}
        pageIndex={pageIndex}
        totalPages={totalPages}
      >
        <View style={styles.emptyWrap}>
          {eyebrow.length > 0 && (
            <Text style={[styles.emptyEyebrow, { color: accent.accent }]}>{eyebrow}</Text>
          )}
          {/* X2: the sentence is the view-model's to choose, not this file's. */}
          <Text style={styles.empty}>{data.emptyMessage}</Text>
        </View>
      </PageFrame>
    );
  }

  // One physical page per chapter — one idea per page is the whole point, and
  // `estimatePlanStoryPageCount` reserved exactly this many sheets.
  return (
    <Fragment>
      {data.chapters.map((chapter, i) => (
        <PageFrame
          key={chapter.chapterId}
          firmName={firmName}
          clientName={clientName}
          reportDate={reportDate}
          pageIndex={pageIndex + i}
          totalPages={totalPages}
        >
          <PlanStoryChapterPdf chapter={chapter} accent={accent} eyebrow={eyebrow} />
        </PageFrame>
      ))}
    </Fragment>
  );
}
