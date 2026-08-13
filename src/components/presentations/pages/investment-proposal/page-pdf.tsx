// One physical page per printed section — one idea per page, and exactly the
// number of sheets `estimateInvestmentProposalPageCount` reserved. That equality
// is the whole contract of this file: `document.tsx` numbers every LATER page in
// the deck from the estimate, so emitting a different number of `PageFrame`s
// hands the client a contents page pointing at the wrong sheets.
//
// Two consequences worth stating outright:
//  · `SECTION_RENDERERS` is a TOTAL record. A `Partial` here would let a missing
//    entry render nothing and silently swallow a reserved sheet; typing it total
//    makes the compiler prove every printed section produces one.
//  · An empty page still fills its reserved sheets. Nothing picked reserves one
//    (see `estimate-page-count.ts`) and prints one; a proposal that was DELETED
//    reserved one per printed section, so each of those prints the message under
//    its own section title rather than collapsing to a single sheet.
import { Fragment, type ReactElement } from "react";
import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { InvestmentProposalPageData } from "@/lib/presentations/pages/investment-proposal/view-model";
import {
  SECTION_TITLES,
  type ProposalSectionId,
} from "@/lib/presentations/pages/investment-proposal/options-schema";
import {
  VerdictSection,
  AllocationSection,
  RiskReturnSection,
  SuitabilitySection,
  type SectionProps,
  type PageFrameProps,
} from "./sections-overview-pdf";

const styles = StyleSheet.create({
  emptyWrap: { paddingTop: 40 },
  empty: { fontSize: 11, color: T.ink3, textAlign: "center" },
});

type SectionComponent = (props: SectionProps) => ReactElement;

// Tightened to a total Record once Tasks 7 and 8 land their sections.
const SECTION_RENDERERS: Partial<Record<ProposalSectionId, SectionComponent>> = {
  verdict: VerdictSection,
  allocation: AllocationSection,
  riskReturn: RiskReturnSection,
  suitability: SuitabilitySection,
};

function EmptySheet({
  title,
  message,
  frame,
  accent,
}: {
  title: string;
  message: string;
  frame: PageFrameProps;
  accent: SectionProps["accent"];
}) {
  return (
    <PageFrame {...frame}>
      <SectionHead title={title} accent={accent} />
      <View style={styles.emptyWrap}>
        <Text style={styles.empty}>{message}</Text>
      </View>
    </PageFrame>
  );
}

export function InvestmentProposalPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: RenderPdfInput<InvestmentProposalPageData>) {
  const frame = { firmName, clientName, reportDate, pageIndex, totalPages };

  if (data.isEmpty) {
    // `null` is the unpicked case: no section list, one sheet, the page's own title.
    const sheets: (ProposalSectionId | null)[] = data.sections.length > 0 ? data.sections : [null];
    return (
      <Fragment>
        {sheets.map((id, i) => (
          <EmptySheet
            key={id ?? "unpicked"}
            title={id ? SECTION_TITLES[id] : data.title}
            message={data.emptyMessage}
            accent={accent}
            frame={{ ...frame, pageIndex: pageIndex + i }}
          />
        ))}
      </Fragment>
    );
  }

  return (
    <Fragment>
      {data.sections.map((id, i) => {
        const Section = SECTION_RENDERERS[id];
        if (!Section) return null;
        return (
          <Section
            key={id}
            data={data}
            accent={accent}
            frame={{ ...frame, pageIndex: pageIndex + i }}
          />
        );
      })}
    </Fragment>
  );
}
