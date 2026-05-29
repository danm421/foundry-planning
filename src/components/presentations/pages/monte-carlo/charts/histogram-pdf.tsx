import { View, Svg, G, Line, Rect, Text as SvgText } from "@react-pdf/renderer";
import { scaleLinear } from "d3-scale";
import { compactCurrency } from "@/lib/presentations/format";
import type { HistogramChartSpec } from "@/lib/presentations/charts/monte-carlo-specs";

export function HistogramPdf({ spec, scale = 1 }: { spec: HistogramChartSpec; scale?: number }) {
  const W = spec.width * scale;
  const H = spec.height * scale;
  const m = spec.margin;
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const x = scaleLinear().domain(spec.xDomain).range([0, innerW]).clamp(true);
  const y = scaleLinear().domain(spec.yDomain).range([innerH, 0]).clamp(true);

  return (
    <View>
      <Svg width={W} height={H}>
        <G transform={`translate(${m.left}, ${m.top})`}>
          {spec.yTicks.map((t) => (
            <G key={`yg-${t}`}>
              <Line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke={spec.colors.grid} strokeWidth={0.5} />
              <SvgText x={-6} y={y(t) + 3} style={{ fontFamily: "JetBrains Mono", fontSize: 7 * scale, fill: spec.colors.axis }}>{String(t)}</SvgText>
            </G>
          ))}
          {spec.bins.map((b, i) => {
            const bx = x(b.x0);
            const bw = Math.max(0, x(b.x1) - x(b.x0) - 1);
            const by = y(b.count);
            return <Rect key={`bin-${i}`} x={bx} y={by} width={bw} height={Math.max(0, innerH - by)} fill={spec.colors.bar} fillOpacity={0.7} />;
          })}
          {spec.percentileMarkers.map((mk) => {
            const cx = x(mk.value);
            const col = mk.emphasis ? spec.colors.markerEmphasis : spec.colors.marker;
            return (
              <G key={`pm-${mk.label}`}>
                <Line x1={cx} x2={cx} y1={0} y2={innerH} stroke={col} strokeWidth={mk.emphasis ? 1.2 : 0.75} strokeDasharray={mk.emphasis ? undefined : "2 2"} />
                <SvgText x={cx + 2} y={8} style={{ fontFamily: "Inter", fontSize: 6 * scale, fill: col }}>{mk.label}</SvgText>
              </G>
            );
          })}
          <SvgText x={0} y={innerH + 12} style={{ fontFamily: "JetBrains Mono", fontSize: 7 * scale, fill: spec.colors.axis }}>{compactCurrency(spec.xDomain[0])}</SvgText>
          <SvgText x={innerW - 30} y={innerH + 12} style={{ fontFamily: "JetBrains Mono", fontSize: 7 * scale, fill: spec.colors.axis }}>{compactCurrency(spec.xDomain[1])}</SvgText>
        </G>
      </Svg>
    </View>
  );
}
