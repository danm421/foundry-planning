import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { Callout } from "@/components/presentations/shared/callout";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { PortfolioAnalysisData } from "@/lib/presentations/pages/portfolio-analysis/view-model";
import { ScatterPdf } from "./scatter-pdf";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const usd = (v: number | null) => (v === null ? "—" : `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

const S = StyleSheet.create({
  headCell: { fontSize: 7, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.5 },
  bodyName: { flex: 2, fontSize: 8, color: T.ink },
  bodyNum: { flex: 1, fontSize: 8, color: T.ink2, textAlign: "right", fontFamily: "JetBrains Mono" },
});

export function PortfolioAnalysisPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
  accent,
}: RenderPdfInput<PortfolioAnalysisData>) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title="Portfolio Analysis" subtitle="Risk &amp; return" accent={accent} />
      <View style={{ alignItems: "center", marginBottom: 14 }}>
        <ScatterPdf spec={data.scatter} />
      </View>
      <View>
        <View style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: T.hair2, paddingBottom: 3 }}>
          <Text style={[S.headCell, { flex: 2 }]}>Name</Text>
          <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Return</Text>
          <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Mean</Text>
          <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>σ</Text>
          <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Sharpe</Text>
          <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>Value</Text>
        </View>
        {data.tableRows.map((r) => (
          <View key={r.key} style={{ flexDirection: "row", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: T.hair2 }}>
            <Text style={S.bodyName}>{r.name}</Text>
            <Text style={S.bodyNum}>{pct(r.geometricReturn)}</Text>
            <Text style={S.bodyNum}>{pct(r.arithmeticMean)}</Text>
            <Text style={S.bodyNum}>{pct(r.stdDev)}</Text>
            <Text style={S.bodyNum}>{r.sharpe === null ? "—" : r.sharpe.toFixed(2)}</Text>
            <Text style={S.bodyNum}>{usd(r.value)}</Text>
          </View>
        ))}
      </View>
      {data.unplottable.length > 0 && (
        <View style={{ marginTop: 10 }}>
          <Callout accent={accent}>
            {`Not shown (no asset-class mix): ${data.unplottable.map((u) => u.name).join(", ")}.`}
          </Callout>
        </View>
      )}
    </PageFrame>
  );
}
