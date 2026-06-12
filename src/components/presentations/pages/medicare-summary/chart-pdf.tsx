import { View, Svg, G, Rect, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { MedicareYearBar } from "@/lib/presentations/pages/medicare-summary/aggregate";

// base drawn first (bottom), irmaa stacked on top so the surcharge band reads.
const SEGMENTS: Array<{ key: "base" | "irmaa"; label: string; color: string }> = [
  { key: "base", label: "Base premiums (Part B / D / Medigap)", color: T.steel },
  { key: "irmaa", label: "IRMAA surcharge", color: T.crit },
];

export function MedicareSummaryChartPdf({ bars }: { bars: MedicareYearBar[] }) {
  const width = 440;
  const height = 150;
  const leftPad = 6;
  const plotH = height - 22; // room for x labels
  const n = Math.max(1, bars.length);
  const slot = (width - leftPad) / n;
  const barWidth = Math.max(2, Math.min(18, slot * 0.7));
  const maxTotal = Math.max(1, ...bars.map((b) => b.total));
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
                const value = b[seg.key];
                if (value <= 0) return null;
                const segH = (value / maxTotal) * plotH;
                yCursor -= segH;
                return <Rect key={seg.key} x={x} y={yCursor} width={barWidth} height={segH} fill={seg.color} />;
              })}
              {i % labelEvery === 0 ? (
                <SvgText x={x + barWidth / 2} y={plotH + 12} textAnchor="middle" style={{ fontSize: 6, fill: T.ink2 }}>
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
