import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { Fragment } from "react";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { ScenarioComparisonPageData } from "@/lib/presentations/pages/scenario-comparison/types";
import { ColumnCardsPdf } from "./column-cards-pdf";
import { MatrixPdf } from "./matrix-pdf";
import { ComparisonChartPdf } from "./chart-pdf";
import { BandPdf } from "./band-pdf";

const s = StyleSheet.create({
  empty: { fontSize: 11, color: T.ink2, textAlign: "center", marginTop: 60 },
  panel: { backgroundColor: T.card, borderWidth: 1, borderColor: T.hair2, borderRadius: 3, padding: 8 },
  h4: { fontSize: 8, color: T.ink2, textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, marginBottom: 6 },
  note: { fontSize: 6.5, color: T.ink3, marginTop: 4, marginBottom: 6, lineHeight: 1.3 },
  // Spacing lives BETWEEN bands, never after the last one.
  bandGap: { height: 8 },
});

export function ScenarioComparisonPagePdf(input: RenderPdfInput<ScenarioComparisonPageData>) {
  const { data, firmName, clientName, reportDate, pageIndex, totalPages, accent } = input;
  const frame = { firmName, clientName, reportDate, totalPages };

  if (data.isEmpty) {
    return (
      <PageFrame {...frame} pageIndex={pageIndex}>
        <SectionHead title={data.title} eyebrow="SCENARIO COMPARISON" accent={accent} />
        <Text style={s.empty}>Choose at least one scenario to compare.</Text>
      </PageFrame>
    );
  }

  return (
    <Fragment>
      <PageFrame {...frame} pageIndex={pageIndex}>
        <SectionHead
          title={data.title}
          subtitle={data.subtitle}
          eyebrow="SCENARIO COMPARISON"
          accent={accent}
        />
        <ColumnCardsPdf columns={data.columns} />
        <MatrixPdf columns={data.columns} rows={data.rows} />
        {data.footnote ? <Text style={s.note}>{data.footnote}</Text> : null}
        {data.chart ? (
          <View style={s.panel}>
            <Text style={s.h4}>Portfolio assets over time</Text>
            <ComparisonChartPdf spec={data.chart} />
          </View>
        ) : null}
      </PageFrame>

      <PageFrame {...frame} pageIndex={pageIndex + 1}>
        <SectionHead
          title="What each scenario trades"
          eyebrow="SCENARIO COMPARISON — TRADEOFFS"
          accent={accent}
        />
        {data.bands.map((b, i) => (
          <Fragment key={b.scenarioId}>
            {i > 0 ? <View style={s.bandGap} /> : null}
            <BandPdf band={b} />
          </Fragment>
        ))}
      </PageFrame>
    </Fragment>
  );
}
