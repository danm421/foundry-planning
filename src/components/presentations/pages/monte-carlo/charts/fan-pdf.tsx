import { View, Svg, G, Line, Polyline, Polygon, Text as SvgText } from "@react-pdf/renderer";
import { scalePoint, scaleLinear } from "d3-scale";
import { compactCurrency } from "@/lib/presentations/format";
import type { FanChartSpec } from "@/lib/presentations/charts/monte-carlo-specs";

export function FanChartPdf({ spec, scale = 1 }: { spec: FanChartSpec; scale?: number }) {
  const W = spec.width * scale;
  const H = spec.height * scale;
  const m = spec.margin;
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const x = scalePoint<number>().domain(spec.years).range([0, innerW]);
  const y = scaleLinear().domain(spec.yDomain).range([innerH, 0]).clamp(true);

  const upperPts = spec.years.map((yr, i) => `${x(yr) ?? 0},${y(spec.band.upper[i])}`);
  const lowerPts = spec.years.map((yr, i) => `${x(yr) ?? 0},${y(spec.band.lower[i])}`);
  const bandPoints = [...upperPts, ...lowerPts.reverse()].join(" ");
  const medianPts = spec.years.map((yr, i) => `${x(yr) ?? 0},${y(spec.median[i])}`).join(" ");
  const detPts = spec.deterministic
    ? spec.years.map((yr, i) => `${x(yr) ?? 0},${y(spec.deterministic![i])}`).join(" ")
    : null;

  return (
    <View>
      <Svg width={W} height={H}>
        <G transform={`translate(${m.left}, ${m.top})`}>
          {spec.yTicks.map((t) => (
            <G key={`yg-${t}`}>
              <Line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke={spec.colors.grid} strokeWidth={0.5} />
              <SvgText x={-6} y={y(t) + 3} style={{ fontFamily: "JetBrains Mono", fontSize: 7 * scale, fill: spec.colors.axis }}>
                {compactCurrency(t)}
              </SvgText>
            </G>
          ))}
          <Polygon points={bandPoints} fill={spec.colors.band} fillOpacity={0.14} stroke="none" />
          {detPts && <Polyline points={detPts} stroke={spec.colors.deterministic} strokeWidth={1} strokeDasharray="3 3" fill="none" />}
          <Polyline points={medianPts} stroke={spec.colors.median} strokeWidth={1.5} fill="none" />
          {spec.markers.map((mk) => {
            const cx = x(mk.atYear);
            if (cx == null) return null;
            return (
              <G key={`mk-${mk.atYear}`}>
                <Line x1={cx} x2={cx} y1={0} y2={innerH} stroke={spec.colors.marker} strokeWidth={1} strokeDasharray="3 3" />
                <SvgText x={cx + 2} y={8} style={{ fontFamily: "Inter", fontSize: 6 * scale, fill: spec.colors.marker }}>{mk.label}</SvgText>
              </G>
            );
          })}
          {spec.xTicks.map((t) => {
            const cx = x(t);
            if (cx == null) return null;
            return (
              <SvgText key={`xl-${t}`} x={cx} y={innerH + 12} style={{ fontFamily: "JetBrains Mono", fontSize: 7 * scale, fill: spec.colors.axis }}>
                {String(t)}
              </SvgText>
            );
          })}
        </G>
      </Svg>
    </View>
  );
}
