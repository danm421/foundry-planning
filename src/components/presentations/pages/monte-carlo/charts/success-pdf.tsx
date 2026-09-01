import { View, Svg, G, Line, Rect, Text as SvgText } from "@react-pdf/renderer";
import { scaleLinear } from "d3-scale";
import type { SuccessChartSpec } from "@/lib/presentations/charts/monte-carlo-specs";
import { Y_TICK_GAP } from "@/lib/presentations/charts/monte-carlo-specs";
import { successBandScale, innerWidth } from "./chart-geom";

export function SuccessPdf({ spec, scale = 1 }: { spec: SuccessChartSpec; scale?: number }) {
  const W = spec.width * scale;
  const H = spec.height * scale;
  const m = spec.margin;
  const innerW = innerWidth(spec, scale);
  const innerH = H - m.top - m.bottom;

  const x = successBandScale(spec, scale);
  const y = scaleLinear().domain([0, 1]).range([innerH, 0]);
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <View>
      <Svg width={W} height={H}>
        <G transform={`translate(${m.left}, ${m.top})`}>
          {yTicks.map((t) => (
            <G key={`yg-${t}`}>
              <Line x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke={spec.colors.grid} strokeWidth={0.5} />
              {/* Right-anchored: the percentage ends 6pt short of the plot and
                  grows leftward into the gutter. `start` ran it over the bars. */}
              <SvgText x={-Y_TICK_GAP} y={y(t) + 3} textAnchor="end" style={{ fontFamily: "JetBrains Mono", fontSize: 7 * scale, fill: spec.colors.axis }}>{Math.round(t * 100)}</SvgText>
            </G>
          ))}
          {spec.bars.map((b, i) => {
            const bx = x(i) ?? 0;
            const by = y(b.value);
            return (
              <G key={`bar-${i}`}>
                <Rect x={bx} y={by} width={x.bandwidth()} height={Math.max(0, innerH - by)} fill={b.color} fillOpacity={0.85} />
                {i % spec.labelEvery === 0 && (
                  /* Centred on the bar. The `- 5` this replaces was a hand-fit to
                     half a two-digit age — within a point for those, but it drifts
                     with the label's width, and this same line prints the four-digit
                     YEAR whenever an age is unavailable: that one landed 3.4pt on,
                     roughly 0.4 of a bar step on a full-length projection. */
                  <SvgText x={bx + x.bandwidth() / 2} y={innerH + 12} textAnchor="middle" style={{ fontFamily: "JetBrains Mono", fontSize: 7 * scale, fill: spec.colors.axis }}>{b.label}</SvgText>
                )}
              </G>
            );
          })}
        </G>
      </Svg>
    </View>
  );
}
