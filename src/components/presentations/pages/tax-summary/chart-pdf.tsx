import { View, Svg, G, Rect, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { TaxYearBar } from "@/lib/presentations/pages/tax-summary/aggregate";

const SEGMENTS: Array<{ key: keyof TaxYearBar; label: string; color: string }> = [
  { key: "federalOrdinary", label: "Federal (ordinary)", color: T.crit },
  { key: "capGains", label: "Capital gains", color: T.accent },
  { key: "state", label: "State", color: T.steel },
];

export function TaxSummaryChartPdf({ bars }: { bars: TaxYearBar[] }) {
  const width = 440;
  const height = 150;
  const leftPad = 6;
  const plotH = height - 22; // room for x labels
  const n = Math.max(1, bars.length);
  const slot = (width - leftPad) / n;
  const barWidth = Math.max(2, Math.min(18, slot * 0.7));
  const maxTotal = Math.max(1, ...bars.map((b) => b.total));
  // Show ~8 evenly spaced year labels regardless of horizon length.
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <View>
      <Svg width={width} height={height}>
        {bars.map((b, i) => {
          const x = leftPad + i * slot + (slot - barWidth) / 2;
          let yCursor = plotH;
          return (
            <G key={b.year}>
              {SEGMENTS.map((seg) => {
                const value = b[seg.key] as number;
                if (value <= 0) return null;
                const segH = (value / maxTotal) * plotH;
                yCursor -= segH;
                return <Rect key={seg.key} x={x} y={yCursor} width={barWidth} height={segH} fill={seg.color} />;
              })}
              {i % labelEvery === 0 ? (
                <SvgText
                  x={x + barWidth / 2}
                  y={plotH + 12}
                  textAnchor="middle"
                  style={{ fontSize: 6, fill: T.ink2 }}
                >
                  {`'${String(b.year).slice(2)}`}
                </SvgText>
              ) : null}
            </G>
          );
        })}
      </Svg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        {SEGMENTS.map((seg) => (
          <View key={seg.key} style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}>
            <View style={{ width: 6, height: 6, backgroundColor: seg.color, marginRight: 3 }} />
            <Text style={{ fontSize: 7, color: T.ink2 }}>{seg.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
