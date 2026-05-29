import { View, Svg, G, Rect, Line, Polyline, Text as SvgText } from "@react-pdf/renderer";
import type { ChartSpec } from "@/lib/presentations/charts/types";
import { scaleLinear, scaleBand } from "d3-scale";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import { stackRects } from "./chart-geom";

export function CashflowChartPdf({ spec }: { spec: ChartSpec }) {
  const innerW = spec.width - spec.margin.left - spec.margin.right;
  const innerH = spec.height - spec.margin.top - spec.margin.bottom;

  const x = scaleBand<number>()
    .domain(spec.xAxis.domain)
    .range([0, innerW])
    .padding(0.2);

  const y = scaleLinear()
    .domain(spec.yAxis.domain)
    .range([innerH, 0]);

  const barWidth = x.bandwidth();

  return (
    <View>
      <Svg width={spec.width} height={spec.height}>
        {/* Gridlines */}
        <G transform={`translate(${spec.margin.left}, ${spec.margin.top})`}>
          {spec.yAxis.ticks.map((t) => (
            <Line
              key={`yg-${t}`}
              x1={0}
              x2={innerW}
              y1={y(t)}
              y2={y(t)}
              stroke={spec.yAxis.gridlineColor}
              strokeWidth={0.5}
            />
          ))}

          {/* Y-axis tick labels */}
          {spec.yAxis.ticks.map((t) => (
            <SvgText
              key={`yl-${t}`}
              x={-6}
              y={y(t) + 3}
              style={{ fontFamily: "JetBrains Mono", fontSize: 7, fill: PRESENTATION_THEME.ink3 }}
            >
              {spec.yAxis.labelFormat(t)}
            </SvgText>
          ))}

          {/* Stacked bars (positive up, negative down from zero) */}
          {spec.xAxis.domain.map((xv, i) => {
            const cx = x(xv);
            if (cx == null) return null;
            const rects = stackRects((v) => y(v), spec.stacks.map((s) => s.values[i] ?? 0));
            return spec.stacks.map((s, k) => (
              <Rect
                key={`bar-${s.seriesId}-${xv}`}
                x={cx}
                y={rects[k].y}
                width={barWidth}
                height={rects[k].height}
                fill={s.color}
              />
            ));
          })}

          {/* Zero baseline for diverging charts */}
          {spec.yAxis.domain[0] < 0 && (
            <Line
              x1={0} x2={innerW} y1={y(0)} y2={y(0)}
              stroke={PRESENTATION_THEME.ink3}
              strokeWidth={0.75}
            />
          )}

          {/* Line overlay (expenses) */}
          {spec.lines.map((ln) => {
            const points = spec.xAxis.domain.map((xv, i) => {
              const cx = (x(xv) ?? 0) + barWidth / 2;
              const cy = y(ln.values[i]);
              return `${cx},${cy}`;
            }).join(" ");
            return (
              <Polyline
                key={`ln-${ln.seriesId}`}
                points={points}
                stroke={ln.color}
                strokeWidth={ln.strokeWidth}
                fill="none"
              />
            );
          })}

          {/* Markers — vertical dashed line + label */}
          {spec.markers.map((m) => {
            const cx = (x(m.atX) ?? 0) + barWidth / 2;
            return (
              <G key={`mk-${m.atX}-${m.iconKind}`}>
                <Line
                  x1={cx} x2={cx} y1={0} y2={innerH}
                  stroke={m.color}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                <SvgText
                  x={cx}
                  y={-4}
                  style={{ fontFamily: "Inter", fontSize: 6, fill: m.color }}
                >
                  {m.label}
                </SvgText>
              </G>
            );
          })}

          {/* X-axis ticks */}
          {spec.xAxis.ticks.map((t) => {
            const cx = (x(t) ?? 0) + barWidth / 2;
            return (
              <SvgText
                key={`xl-${t}`}
                x={cx}
                y={innerH + 12}
                style={{ fontFamily: "JetBrains Mono", fontSize: 7, fill: PRESENTATION_THEME.ink3 }}
              >
                {spec.xAxis.labelFormat(t)}
              </SvgText>
            );
          })}
        </G>

        {/* Legend at bottom */}
        <G transform={`translate(${spec.margin.left}, ${spec.height - spec.margin.bottom + 28})`}>
          {spec.legend.items.map((item, i) => {
            const itemX = i * 85;
            return (
              <G key={`lg-${item.label}`} transform={`translate(${itemX}, 0)`}>
                {item.kind === "swatch" ? (
                  <Rect x={0} y={-6} width={8} height={8} fill={item.color} />
                ) : (
                  <Line x1={0} x2={10} y1={-2} y2={-2} stroke={item.color} strokeWidth={1.5} />
                )}
                <SvgText
                  x={14}
                  y={2}
                  style={{ fontFamily: "Inter", fontSize: 7, fill: PRESENTATION_THEME.ink2 }}
                >
                  {item.label}
                </SvgText>
              </G>
            );
          })}
        </G>
      </Svg>
    </View>
  );
}
