import { View, Text } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { Callout } from "@/components/presentations/shared/callout";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { AssetAllocationData } from "@/lib/presentations/pages/asset-allocation/view-model";
import { DonutPdf } from "./donut-pdf";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const usd = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function AssetAllocationPagePdf({
  data,
  firmName,
  clientName,
  reportDate,
  pageIndex,
  totalPages,
}: RenderPdfInput<AssetAllocationData>) {
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title="Asset Allocation" subtitle={data.subtitle} />
      <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 14 }}>
        <DonutPdf spec={data.currentDonut} title="Current allocation" />
        {data.benchmarkDonut && <DonutPdf spec={data.benchmarkDonut} title="Recommended portfolio" />}
      </View>
      {data.tableRows.length > 0 && (
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: T.hair, paddingBottom: 3 }}>
            <Text style={{ flex: 2, fontSize: 7, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.5 }}>Asset class</Text>
            <Text style={{ flex: 1, fontSize: 7, color: T.ink3, textAlign: "right", textTransform: "uppercase", letterSpacing: 0.5 }}>Value</Text>
            <Text style={{ flex: 1, fontSize: 7, color: T.ink3, textAlign: "right", textTransform: "uppercase", letterSpacing: 0.5 }}>Current</Text>
            {data.benchmarkDonut && <Text style={{ flex: 1, fontSize: 7, color: T.ink3, textAlign: "right", textTransform: "uppercase", letterSpacing: 0.5 }}>Target</Text>}
          </View>
          {data.tableRows.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", paddingVertical: 2, borderBottomWidth: 0.25, borderBottomColor: T.hair }}>
              <Text style={{ flex: 2, fontSize: 8, color: T.ink }}>{r.name}</Text>
              <Text style={{ flex: 1, fontSize: 8, color: T.ink2, textAlign: "right", fontFamily: "JetBrains Mono" }}>{usd(r.value)}</Text>
              <Text style={{ flex: 1, fontSize: 8, color: T.ink2, textAlign: "right", fontFamily: "JetBrains Mono" }}>{pct(r.currentPct)}</Text>
              {data.benchmarkDonut && <Text style={{ flex: 1, fontSize: 8, color: T.ink2, textAlign: "right", fontFamily: "JetBrains Mono" }}>{r.targetPct === null ? "—" : pct(r.targetPct)}</Text>}
            </View>
          ))}
        </View>
      )}
      {data.driftRows && data.driftRows.length > 0 && (
        <View style={{ marginBottom: 10 }}>
          <Text style={{ fontSize: 9, fontFamily: "Fraunces", color: T.ink, marginBottom: 4 }}>Drift vs. target</Text>
          {data.driftRows.map((d) => (
            <View key={d.assetClassId} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
              <Text style={{ flex: 2, fontSize: 8, color: T.ink2 }}>{d.name}</Text>
              <View style={{ flex: 3, height: 8, backgroundColor: T.card, position: "relative" }}>
                <View style={{
                  position: "absolute", left: "50%",
                  width: `${Math.min(50, Math.abs(d.diffPct) * 100 * 2)}%`,
                  ...(d.diffPct >= 0 ? {} : { right: "50%", left: undefined as never }),
                  height: 8, backgroundColor: d.diffPct >= 0 ? T.good : T.accent,
                }} />
              </View>
              <Text style={{ flex: 1, fontSize: 8, color: T.ink2, textAlign: "right", fontFamily: "JetBrains Mono" }}>
                {`${d.diffPct >= 0 ? "+" : ""}${(d.diffPct * 100).toFixed(1)}%`}
              </Text>
            </View>
          ))}
        </View>
      )}
      <Callout>{data.disclosure}</Callout>
    </PageFrame>
  );
}
