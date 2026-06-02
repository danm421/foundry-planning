import { View, Svg, G, Rect, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import type { EstateSummaryChartBar } from "@/lib/presentations/pages/estate-summary/view-model";
import { fmtUsd } from "@/lib/presentations/pages/estate-summary/aggregate";

const SEGMENTS: Array<{ key: keyof EstateSummaryChartBar; label: string; color: string }> = [
  { key: "netToHeirs", label: "Net to heirs", color: PRESENTATION_THEME.good },
  { key: "federal", label: "Federal", color: PRESENTATION_THEME.crit },
  { key: "state", label: "State", color: PRESENTATION_THEME.accent },
  { key: "probate", label: "Probate/admin", color: PRESENTATION_THEME.steel },
  { key: "ird", label: "IRD", color: PRESENTATION_THEME.accentMuted },
  { key: "debts", label: "Debts", color: PRESENTATION_THEME.ink3 },
];

export function EstateSummaryChartPdf({ bars }: { bars: EstateSummaryChartBar[] }) {
  const width = 300;
  const height = 88;
  const barWidth = 54;
  const gap = 60;
  const leftPad = 40;
  const maxTotal = Math.max(1, ...bars.map((b) => b.total));
  const plotH = height - 24; // leave room for x labels

  return (
    <View>
      <Svg width={width} height={height}>
        {bars.map((b, i) => {
          const x = leftPad + i * (barWidth + gap);
          let yCursor = plotH;
          return (
            <G key={b.label}>
              {SEGMENTS.map((seg) => {
                const value = b[seg.key] as number;
                if (value <= 0) return null;
                const segH = (value / maxTotal) * plotH;
                yCursor -= segH;
                return (
                  <Rect
                    key={seg.key}
                    x={x}
                    y={yCursor}
                    width={barWidth}
                    height={segH}
                    fill={seg.color}
                  />
                );
              })}
              <SvgText
                x={x + barWidth / 2}
                y={plotH + 12}
                textAnchor="middle"
                style={{ fontSize: 8, fill: PRESENTATION_THEME.ink }}
              >
                {b.label}
              </SvgText>
              <SvgText
                x={x + barWidth / 2}
                y={plotH + 21}
                textAnchor="middle"
                style={{ fontSize: 7, fill: PRESENTATION_THEME.ink2 }}
              >
                {fmtUsd(b.total)}
              </SvgText>
            </G>
          );
        })}
      </Svg>
      {/* Legend — OUTSIDE the Svg: flex row, colored View swatches + layout Text labels */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 4 }}>
        {SEGMENTS.map((seg) => (
          <View
            key={seg.key}
            style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}
          >
            <View style={{ width: 6, height: 6, backgroundColor: seg.color, marginRight: 3 }} />
            <Text style={{ fontSize: 7, color: PRESENTATION_THEME.ink2 }}>{seg.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
