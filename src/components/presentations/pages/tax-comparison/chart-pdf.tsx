import { View, Svg, G, Rect, Polyline, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { TaxComparisonChartYear } from "@/lib/presentations/pages/tax-comparison/view-model";

const SEGMENTS: Array<{ key: keyof TaxComparisonChartYear; label: string; color: string }> = [
  { key: "federalOrdinary", label: "Federal (ordinary)", color: T.crit },
  { key: "capGains", label: "Capital gains", color: T.accent },
  { key: "state", label: "State", color: T.steel },
];

export function TaxComparisonChartPdf({ years }: { years: TaxComparisonChartYear[] }) {
  const width = 440;
  const height = 150;
  const leftPad = 6;
  const plotH = height - 22;
  const n = Math.max(1, years.length);
  const slot = (width - leftPad) / n;
  const barWidth = Math.max(2, Math.min(18, slot * 0.7));
  // Span both series so the base line never clips above the scenario stacks.
  const maxTotal = Math.max(1, ...years.map((y) => Math.max(y.total, y.baseTotal)));
  const labelEvery = Math.max(1, Math.ceil(n / 8));
  const linePoints = years
    .map((y, i) => {
      const cx = leftPad + i * slot + slot / 2;
      const cy = plotH - (y.baseTotal / maxTotal) * plotH;
      return `${cx.toFixed(1)},${cy.toFixed(1)}`;
    })
    .join(" ");

  return (
    <View>
      <Svg width={width} height={height}>
        {years.map((y, i) => {
          const x = leftPad + i * slot + (slot - barWidth) / 2;
          let yCursor = plotH;
          return (
            <G key={y.year}>
              {SEGMENTS.map((seg) => {
                const value = y[seg.key] as number;
                if (value <= 0) return null;
                const segH = (value / maxTotal) * plotH;
                yCursor -= segH;
                return <Rect key={seg.key} x={x} y={yCursor} width={barWidth} height={segH} fill={seg.color} />;
              })}
              {i % labelEvery === 0 ? (
                <SvgText x={x + barWidth / 2} y={plotH + 12} textAnchor="middle" style={{ fontSize: 6, fill: T.ink2 }}>
                  {`'${String(y.year).slice(2)}`}
                </SvgText>
              ) : null}
            </G>
          );
        })}
        <Polyline points={linePoints} fill="none" stroke={T.ink2} strokeWidth={1} strokeDasharray="3 2" />
      </Svg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        {SEGMENTS.map((seg) => (
          <View key={seg.key} style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}>
            <View style={{ width: 6, height: 6, backgroundColor: seg.color, marginRight: 3 }} />
            <Text style={{ fontSize: 7, color: T.ink2 }}>{seg.label}</Text>
          </View>
        ))}
        <View style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}>
          <View style={{ width: 10, height: 0, borderTopWidth: 1, borderTopColor: T.ink2, borderStyle: "dashed", marginRight: 3 }} />
          <Text style={{ fontSize: 7, color: T.ink2 }}>Base total</Text>
        </View>
      </View>
    </View>
  );
}
