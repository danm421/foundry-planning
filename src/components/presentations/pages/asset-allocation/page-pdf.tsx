import { View, Text, StyleSheet } from "@react-pdf/renderer";
import { PageFrame } from "@/components/presentations/shared/page-frame";
import { SectionHead } from "@/components/presentations/shared/section-head";
import { Callout } from "@/components/presentations/shared/callout";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { RenderPdfInput } from "@/components/presentations/registry";
import type { AssetAllocationData } from "@/lib/presentations/pages/asset-allocation/view-model";
import { DonutPdf } from "./donut-pdf";

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const money = (v: number) => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const S = StyleSheet.create({
  headCell: { fontSize: 7, color: T.ink3, textTransform: "uppercase", letterSpacing: 0.5 },
  bodyName: { flex: 2, fontSize: 8, color: T.ink },
  bodyNum: { flex: 1, fontSize: 8, color: T.ink2, textAlign: "right", fontFamily: "JetBrains Mono" },
});

export function AssetAllocationPagePdf({
  data, firmName, clientName, reportDate, pageIndex, totalPages, accent,
}: RenderPdfInput<AssetAllocationData>) {
  const hasRight = data.rightDonut !== null;
  const hasDiff = !!(data.diffRows && data.diffRows.length > 0);
  const showTable = data.tableRows.length > 0;
  const hasExcluded = data.excludedRows.length > 0;
  return (
    <PageFrame
      firmName={firmName}
      clientName={clientName}
      reportDate={reportDate}
      pageIndex={pageIndex}
      totalPages={totalPages}
    >
      <SectionHead title="Asset Allocation" subtitle={data.subtitle} accent={accent} />
      <View style={{ flexDirection: "row", justifyContent: "space-around", marginBottom: 14 }}>
        <DonutPdf spec={data.leftDonut} title={data.leftName} />
        {/* rightName is non-null whenever rightDonut is (both derive from `right` in the view-model) */}
        {data.rightDonut && <DonutPdf spec={data.rightDonut} title={data.rightName!} />}
      </View>
      {(showTable || hasDiff) && (
        // Table and Difference sit side-by-side so the page stays single-page.
        <View style={{ flexDirection: "row", marginBottom: 12 }}>
          {showTable && (
            <View style={{ flex: 1, marginRight: hasDiff ? 18 : 0 }}>
              <View style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: T.hair2, paddingBottom: 3 }}>
                <Text style={[S.headCell, { flex: 2 }]}>Asset class</Text>
                <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>{data.leftName}</Text>
                {hasRight && <Text style={[S.headCell, { flex: 1, textAlign: "right" }]}>{data.rightName}</Text>}
              </View>
              {data.tableRows.map((r) => (
                <View key={r.id} style={{ flexDirection: "row", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: T.hair2 }}>
                  <Text style={S.bodyName}>{r.name}</Text>
                  <Text style={S.bodyNum}>{pct(r.leftPct)}</Text>
                  {hasRight && <Text style={S.bodyNum}>{pct(r.rightPct)}</Text>}
                </View>
              ))}
            </View>
          )}
          {hasDiff && (
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 9, fontFamily: "Fraunces", color: T.ink, marginBottom: 4 }}>
                {`Difference: ${data.leftName} vs ${data.rightName}`}
              </Text>
              {data.diffRows!.map((d) => (
                <View key={d.id} style={{ flexDirection: "row", alignItems: "center", marginBottom: 2 }}>
                  <Text style={{ flex: 3, fontSize: 8, color: T.ink2 }}>{d.name}</Text>
                  <View style={{ flex: 2, height: 8, backgroundColor: T.card, position: "relative" }}>
                    <View style={{
                      position: "absolute", left: "50%",
                      width: `${Math.min(50, Math.abs(d.diffPct) * 100 * 2)}%`,
                      // @react-pdf: unset base `left` for the negative (left-side) bar
                      ...(d.diffPct >= 0 ? {} : { right: "50%", left: undefined as never }),
                      height: 8, backgroundColor: d.diffPct >= 0 ? T.good : T.accent,
                    }} />
                  </View>
                  <Text style={{ flex: 1.2, fontSize: 8, color: T.ink2, textAlign: "right", fontFamily: "JetBrains Mono" }}>
                    {`${d.diffPct >= 0 ? "+" : ""}${(d.diffPct * 100).toFixed(1)}%`}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
      {hasExcluded && (
        // Itemizes the "accounts without an asset mix" portion of the disclosure.
        <View style={{ width: "58%", marginBottom: 12 }}>
          <Text style={{ fontSize: 9, fontFamily: "Fraunces", color: T.ink, marginBottom: 4 }}>
            Accounts without an asset mix
          </Text>
          {data.excludedRows.map((r) => (
            <View key={r.id} style={{ flexDirection: "row", paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: T.hair2 }}>
              <Text style={S.bodyName}>{r.name}</Text>
              <Text style={S.bodyNum}>{money(r.value)}</Text>
            </View>
          ))}
          <View style={{ flexDirection: "row", paddingTop: 3, borderTopWidth: 0.5, borderTopColor: T.hair2 }}>
            <Text style={[S.bodyName, { fontFamily: "Fraunces" }]}>Total</Text>
            <Text style={[S.bodyNum, { color: T.ink }]}>{money(data.excludedTotal)}</Text>
          </View>
        </View>
      )}
      <Callout accent={accent}>{data.disclosure}</Callout>
    </PageFrame>
  );
}
