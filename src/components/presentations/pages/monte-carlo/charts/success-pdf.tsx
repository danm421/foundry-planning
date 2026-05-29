import { View, Svg, G, Line, Rect, Text as SvgText } from "@react-pdf/renderer";
import { scaleBand, scaleLinear } from "d3-scale";
import type { SuccessChartSpec } from "@/lib/presentations/charts/monte-carlo-specs";

export function SuccessPdf({ spec, scale = 1 }: { spec: SuccessChartSpec; scale?: number }) {
  const W = spec.width * scale;
  const H = spec.height * scale;
  const m = spec.margin;
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const x = scaleBand<number>().domain(spec.bars.map((_, i) => i)).range([0, innerW]).padding(0.08);
  const y = scaleLinear().domain([0, 1]).range([innerH, 0]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <View>
      <Svg width={W} height={H}>
        <G transform={`translate(${m.left}, ${m.top})`}>
          {yTicks.map((t) => (
            <G key={`yg-${t}`}>
              <Line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke={spec.colors.grid} strokeWidth={0.5} />
              <SvgText x={-6} y={y(t) + 3} style={{ fontFamily: "JetBrains Mono", fontSize: 7 * scale, fill: spec.colors.axis }}>{Math.round(t * 100)}</SvgText>
            </G>
          ))}
          {spec.bars.map((b, i) => {
            const bx = x(i) ?? 0;
            const by = y(b.value);
            return (
              <G key={`bar-${i}`}>
                <Rect x={bx} y={by} width={x.bandwidth()} height={Math.max(0, innerH - by)} fill={b.color} fillOpacity={0.85} />
                {i % spec.labelEvery === 0 && (
                  <SvgText x={bx + x.bandwidth() / 2 - 5} y={innerH + 12} style={{ fontFamily: "JetBrains Mono", fontSize: 7 * scale, fill: spec.colors.axis }}>{b.label}</SvgText>
                )}
              </G>
            );
          })}
        </G>
      </Svg>
    </View>
  );
}
