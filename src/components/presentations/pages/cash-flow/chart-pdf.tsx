import { View, Svg, G, Rect, Line, Polyline, Text as SvgText } from "@react-pdf/renderer";
import type { ChartSpec } from "@/lib/presentations/charts/types";
import { scaleLinear } from "d3-scale";
import { PRESENTATION_THEME } from "@/lib/presentations/theme";
import {
  bandScale, legendLayout, legendSlot, markerLabelLayout,
  LEGEND_LABEL_X, stackRects,
} from "./chart-geom";

export function CashflowChartPdf({ spec }: { spec: ChartSpec }) {
  const innerW = spec.width - spec.margin.left - spec.margin.right;
  const innerH = spec.height - spec.margin.top - spec.margin.bottom;

  const x = bandScale(spec);

  const y = scaleLinear()
    .domain(spec.yAxis.domain)
    .range([innerH, 0]);

  const barWidth = x.bandwidth();

  // The legend starts at the left margin, so the room it has is the plot's own
  // width — never the canvas's.
  const legend = legendLayout(spec.legend.items.length, innerW);

  // Marker labels are laid out together, not one at a time: whether one has to
  // move depends on where its neighbours landed.
  const markerLabels = markerLabelLayout(
    spec.markers,
    spec.markers.map((m) => (x(m.atX) ?? 0) + barWidth / 2),
    spec,
  );

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

          {/* Y-axis tick labels. Anchored at their RIGHT edge, so the label
              ends 6pt left of the plot and grows leftward into the margin.
              Left at SVG's default `start` it began 6pt left of the plot and
              ran rightward THROUGH it — every label printed over the first two
              bars. Widening margin.left cannot fix that: it moves the plot and
              the label together. */}
          {spec.yAxis.ticks.map((t) => (
            <SvgText
              key={`yl-${t}`}
              x={-6}
              y={y(t) + 3}
              textAnchor="end"
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

          {/* Markers — vertical dashed line + label. The line always stands on
              the bar; the label is placed by `markerLabelLayout`, which clamps
              it onto the canvas and stacks it clear of its neighbours. Centring
              each label on its own bar is correct one at a time and unreadable
              in a group — a couple's two retirement markers are one year apart,
              so ~80pt labels sat on centres ~14pt apart and overprinted. */}
          {spec.markers.map((m, i) => {
            const cx = (x(m.atX) ?? 0) + barWidth / 2;
            const place = markerLabels[i];
            return (
              <G key={`mk-${m.atX}-${m.iconKind}`}>
                <Line
                  x1={cx} x2={cx} y1={0} y2={innerH}
                  stroke={m.color}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {/* Anchored `middle` on the placed centre. Under SVG's default
                    `start` the label began at the centre and ran right, so its
                    own centre landed a full bar-step on — it annotated the bar
                    AFTER the one it marks. */}
                <SvgText
                  x={place.x}
                  y={place.y}
                  textAnchor="middle"
                  style={{ fontFamily: "Inter", fontSize: 6, fill: m.color }}
                >
                  {m.label}
                </SvgText>
              </G>
            );
          })}

          {/* X-axis ticks. Centred, so each year sits under the bar it names —
              left at `start` the label ran rightward from the bar centre and
              its own centre landed 8.4pt on, silently naming the wrong year on
              every tick. Anchoring also pulls the last tick back out of the
              right margin. */}
          {spec.xAxis.ticks.map((t) => {
            const cx = (x(t) ?? 0) + barWidth / 2;
            return (
              <SvgText
                key={`xl-${t}`}
                x={cx}
                y={innerH + 12}
                textAnchor="middle"
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
            // Wraps — see `legendLayout`. A second row sits inside the bottom
            // margin the legend already lives in, so nothing needs to grow.
            const slot = legendSlot(i, legend);
            return (
              <G key={`lg-${item.label}`} transform={`translate(${slot.x}, ${slot.y})`}>
                {item.kind === "swatch" ? (
                  <Rect x={0} y={-6} width={8} height={8} fill={item.color} />
                ) : (
                  <Line x1={0} x2={10} y1={-2} y2={-2} stroke={item.color} strokeWidth={1.5} />
                )}
                {/* Left-anchored on purpose: the label reads rightward away
                    from the swatch or rule it belongs to. */}
                <SvgText
                  x={LEGEND_LABEL_X}
                  y={2}
                  textAnchor="start"
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
