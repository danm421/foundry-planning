import { View, Svg, G, Rect, Text as SvgText, Text, StyleSheet } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T, ZEBRA_FILL } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import { fmtUsdCompact as fmtUsd } from "@/lib/presentations/pages/retirement-comparison/format";
import { MONO } from "./chart-axis";
import type { TaxBuckets } from "@/lib/presentations/pages/retirement-comparison/tax-buckets";
import type { TaxTreatmentBreakdown } from "@/lib/presentations/pages/retirement-comparison/types";

/** Render order + label + color for the tax-treatment buckets. After-tax →
 *  tax-deferred → tax-free, so the stack reads as a tax-liability gradient.
 *  Shared with the condensed end-of-life table on page 2. */
export const TAX_BUCKETS: { key: keyof TaxBuckets; label: string; color: string }[] = [
  { key: "cash", label: "Cash", color: dataLight.grey },
  { key: "taxable", label: "Taxable", color: dataLight.blue },
  { key: "preTax", label: "Pre-tax", color: dataLight.orange },
  { key: "roth", label: "Roth", color: dataLight.green },
  { key: "hsa", label: "HSA", color: dataLight.teal },
];

export const sumBuckets = (b: TaxBuckets): number => b.cash + b.taxable + b.preTax + b.roth + b.hsa;
const signed = (d: number): string => `${d >= 0 ? "+" : "−"}${fmtUsd(Math.abs(d))}`;

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 18 },
  th: { fontSize: 6, color: T.ink3, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.3 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: T.hair2, paddingBottom: 3 },
  cellRow: { flexDirection: "row", alignItems: "center", paddingVertical: 2.5, paddingHorizontal: 2 },
  swatch: { width: 6, height: 6, borderRadius: 1, marginRight: 5 },
  lblWrap: { flex: 1.5, flexDirection: "row", alignItems: "center" },
  lbl: { fontSize: 7.5, color: T.ink },
  num: { flex: 1, fontSize: 7.5, color: T.ink, textAlign: "right", fontFamily: MONO },
  delta: { flex: 1, fontSize: 7, textAlign: "right", fontFamily: MONO },
  totalRow: { flexDirection: "row", alignItems: "center", paddingTop: 3, paddingHorizontal: 2, marginTop: 1, borderTopWidth: 1, borderTopColor: T.hair2 },
  totalLbl: { flex: 1.5, fontSize: 7.5, color: T.ink, fontWeight: 600 },
  totalNum: { flex: 1, fontSize: 8, color: T.ink, fontWeight: 600, textAlign: "right", fontFamily: MONO },
});

/** Paired stacked columns (Current vs Proposed) + a per-bucket value table.
 *  Buckets that are zero in BOTH plans are hidden. `compact` drops the bars and
 *  renders the value table only (the page-2 end-of-life summary). */
export function TaxTreatmentChartPdf({ data, compact = false }: { data: TaxTreatmentBreakdown; compact?: boolean }) {
  const { base, scenario } = data;
  const buckets = TAX_BUCKETS.filter((b) => base[b.key] > 0 || scenario[b.key] > 0);
  const baseTotal = sumBuckets(base);
  const scnTotal = sumBuckets(scenario);
  const maxTotal = Math.max(1, baseTotal, scnTotal);

  const colW = 38, gap = 26, plotH = 112, topPad = 13;
  const svgW = colW * 2 + gap;
  const svgH = plotH + topPad + 14;

  const column = (b: TaxBuckets, x: number, total: number, label: string) => {
    let y = topPad + plotH;
    const rects = buckets.map((bk) => {
      const h = (b[bk.key] / maxTotal) * plotH;
      y -= h;
      return <Rect key={bk.key} x={x} y={y} width={colW} height={h} fill={bk.color} />;
    });
    const topY = topPad + plotH - (total / maxTotal) * plotH;
    return (
      <G key={label}>
        {rects}
        <SvgText x={x + colW / 2} y={topY - 4} textAnchor="middle" style={{ fontSize: 8, fontWeight: 600, fill: T.ink, fontFamily: MONO }}>
          {fmtUsd(total)}
        </SvgText>
        <SvgText x={x + colW / 2} y={topPad + plotH + 11} textAnchor="middle" style={{ fontSize: 7, fill: T.ink2 }}>
          {label}
        </SvgText>
      </G>
    );
  };

  const table = (
    <View style={compact ? { width: "100%" } : { flex: 1 }}>
      <View style={s.headRow}>
        <Text style={[s.th, { flex: 1.5 }]}> </Text>
        <Text style={[s.th, { flex: 1, textAlign: "right" }]}>Current</Text>
        <Text style={[s.th, { flex: 1, textAlign: "right" }]}>Proposed</Text>
        <Text style={[s.th, { flex: 1, textAlign: "right" }]}>Change</Text>
      </View>
      {buckets.map((bk, i) => {
        const d = scenario[bk.key] - base[bk.key];
        return (
          <View key={bk.key} style={i % 2 ? [s.cellRow, { backgroundColor: ZEBRA_FILL }] : s.cellRow}>
            <View style={s.lblWrap}>
              <View style={[s.swatch, { backgroundColor: bk.color }]} />
              <Text style={s.lbl}>{bk.label}</Text>
            </View>
            <Text style={s.num}>{fmtUsd(base[bk.key])}</Text>
            <Text style={s.num}>{fmtUsd(scenario[bk.key])}</Text>
            <Text style={[s.delta, { color: d >= 0 ? T.good : T.ink3 }]}>{signed(d)}</Text>
          </View>
        );
      })}
      <View style={s.totalRow}>
        <Text style={s.totalLbl}>Total</Text>
        <Text style={s.totalNum}>{fmtUsd(baseTotal)}</Text>
        <Text style={s.totalNum}>{fmtUsd(scnTotal)}</Text>
        <Text style={[s.delta, { color: scnTotal - baseTotal >= 0 ? T.good : T.ink3, fontSize: 7.5 }]}>
          {signed(scnTotal - baseTotal)}
        </Text>
      </View>
    </View>
  );

  if (compact) return table;

  return (
    <View style={s.row}>
      <Svg width={svgW} height={svgH}>
        {column(base, 0, baseTotal, "Current")}
        {column(scenario, colW + gap, scnTotal, "Proposed")}
      </Svg>
      {table}
    </View>
  );
}
