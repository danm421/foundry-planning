import { View, Svg, G, Line, Polyline, Text as SvgText } from "@react-pdf/renderer";
import { scaleLinear } from "d3-scale";
import type { ChartSpec } from "@/lib/presentations/charts/types";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { MONO } from "@/components/presentations/pages/retirement-comparison/chart-axis";
import { ChartLegend } from "@/components/presentations/pages/retirement-comparison/chart-legend-pdf";
import { bandScale, markerLabelLayout } from "@/components/presentations/pages/cash-flow/chart-geom";

export interface PlotPoint {
  x: number;
  y: number;
}

/**
 * One `points` string per contiguous run of drawable points — the gap contract's
 * renderer half.
 *
 * Two plans can run to different end years, so the chart's x domain is the union
 * and a plan that stops early has NO value for the later years. `chart-spec.ts`
 * writes `NaN` there, because `ChartSpec.lines[].values` is `number[]` with no
 * null channel and a zero would draw a cliff to the axis that the plan does not
 * have.
 *
 * The cash-flow renderer joins every point into ONE `<Polyline>`. Doing that
 * here would emit the literal token `"481,NaN"` into the points attribute and
 * corrupt the whole line, so the run is closed on a non-finite value instead and
 * a plan that ends early simply stops being drawn.
 *
 * The test is finiteness of the COMPUTED coordinate, not of the source value: it
 * catches the `NaN` sentinel, a scale that degenerates, and an x that falls
 * outside the band domain, which are the same defect at the point it matters.
 *
 * A one-point run is kept rather than filtered: it is a valid points attribute
 * that draws nothing, which is exactly what a single year with no neighbour
 * should look like.
 */
export function polylineRuns(points: ReadonlyArray<PlotPoint>): string[] {
  const runs: string[] = [];
  let run: string[] = [];
  const close = () => {
    if (run.length > 0) runs.push(run.join(" "));
    run = [];
  };
  for (const p of points) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) run.push(`${p.x},${p.y}`);
    else close();
  }
  close();
  return runs;
}

/**
 * The four-column portfolio chart: one line per column over the union of every
 * plan's years, a dashed rule at each distinct retirement year, and a legend.
 *
 * Scales and marker placement come from `cash-flow/chart-geom` rather than being
 * restated — those are the numbers the deck's other charts are laid out with.
 * `CashflowChartPdf` itself is not reused: it draws stacked bars this page has
 * none of, and its single-polyline line path cannot carry a gap (above).
 *
 * The legend is the deck's existing `ChartLegend`, placed BELOW the canvas
 * rather than inside it. Cash-flow draws its legend into the bottom margin, but
 * this chart's margin is 22pt and the x-axis labels already take 12 of it — an
 * in-canvas legend would print on the year labels, and any slot pushed past the
 * viewport would not be drawn at all: no error, no clipping artefact, just a
 * missing name. In flow it wraps instead, so every item is rendered.
 *
 * Every `SvgText` below names its own `textAnchor`, and no ancestor `Svg` or `G`
 * sets one — `textAnchor` inherits down the SVG tree, so an alignment that is not
 * written here would come from somewhere else in the file.
 */
export function ComparisonChartPdf({ spec }: { spec: ChartSpec }) {
  const innerW = spec.width - spec.margin.left - spec.margin.right;
  const innerH = spec.height - spec.margin.top - spec.margin.bottom;

  const x = bandScale(spec);
  const y = scaleLinear().domain(spec.yAxis.domain).range([innerH, 0]);

  // A line's point sits on its year's band centre, the same place the x-axis
  // tick and the retirement rule stand.
  const halfBand = x.bandwidth() / 2;
  const centre = (year: number) => (x(year) ?? NaN) + halfBand;

  // A marker off the domain has no band to stand on; `x()` returns undefined and
  // it would otherwise be drawn at the plot's left edge, annotating a year it
  // does not mark.
  const markers = spec.markers.filter((m) => Number.isFinite(centre(m.atX)));

  // Laid out together, not one at a time: whether a label has to move depends on
  // where its neighbours landed.
  const markerLabels = markerLabelLayout(markers, markers.map((m) => centre(m.atX)), spec);

  return (
    <View>
      <Svg width={spec.width} height={spec.height}>
        <G transform={`translate(${spec.margin.left}, ${spec.margin.top})`}>
          {/* Gridlines */}
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

          {/* Y-axis tick labels, anchored at their RIGHT edge so each ends 6pt
              left of the plot and grows leftward into the margin. At SVG's
              default `start` they run rightward THROUGH the plot. */}
          {spec.yAxis.ticks.map((t) => (
            <SvgText
              key={`yl-${t}`}
              x={-6}
              y={y(t) + 3}
              textAnchor="end"
              style={{ fontFamily: MONO, fontSize: 7, fill: T.ink3 }}
            >
              {spec.yAxis.labelFormat(t)}
            </SvgText>
          ))}

          {/* One line per column. `spec.stacks` is empty on this page by
              construction — it is a pure line chart — so no bars are drawn. */}
          {spec.lines.map((ln) => {
            const points = spec.xAxis.domain.map((year, i) => ({
              x: centre(year),
              y: y(ln.values[i] ?? NaN),
            }));
            return polylineRuns(points).map((run, r) => (
              <Polyline
                key={`ln-${ln.seriesId}-${r}`}
                points={run}
                stroke={ln.color}
                strokeWidth={ln.strokeWidth}
                fill="none"
              />
            ));
          })}

          {/* Retirement markers — dashed rule on the band, label placed by
              `markerLabelLayout`, which clamps it onto the canvas and stacks it
              clear of its neighbours. */}
          {markers.map((m, i) => {
            const cx = centre(m.atX);
            const place = markerLabels[i];
            return (
              <G key={`mk-${m.atX}-${m.iconKind}`}>
                <Line
                  x1={cx}
                  x2={cx}
                  y1={0}
                  y2={innerH}
                  stroke={m.color}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {/* Anchored `middle` on the placed centre: at `start` the label
                    begins at the centre and runs right, so its own centre lands a
                    full band-step on. */}
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

          {/* X-axis ticks, centred so each year sits under the band it names. */}
          {spec.xAxis.ticks.map((t) => (
            <SvgText
              key={`xl-${t}`}
              x={centre(t)}
              y={innerH + 12}
              textAnchor="middle"
              style={{ fontFamily: MONO, fontSize: 7, fill: T.ink3 }}
            >
              {spec.xAxis.labelFormat(t)}
            </SvgText>
          ))}
        </G>
      </Svg>

      <ChartLegend items={spec.legend.items.map((it) => ({ label: it.label, color: it.color }))} />
    </View>
  );
}
