// src/components/presentations/pages/life-insurance-summary/chart-pdf.tsx
import { View, Svg, G, Rect, Line, Circle, Text as SvgText } from "@react-pdf/renderer";
import { scaleLinear, scaleBand } from "d3-scale";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import type { LiChart } from "@/lib/presentations/pages/life-insurance-summary/view-model";
import { fmtUsd } from "@/lib/presentations/pages/life-insurance-summary/aggregate";

/** The chart's canvas and plot box. Exported with `liChartGeom` so the geometry
 *  guard measures against the numbers the component draws with. */
export const LI_CHART_BOX = {
  width: 520,
  height: 200,
  margin: { top: 16, right: 14, bottom: 28, left: 44 },
};
const { width: W, height: H, margin: M } = LI_CHART_BOX;

/** Everything the chart derives from its data before drawing: the two scales,
 *  the y ticks, and which years get an x label. */
export function liChartGeom(chart: LiChart, married: boolean) {
  const innerW = W - M.left - M.right;
  const innerH = H - M.top - M.bottom;

  const years = chart.rows.map((r) => r.year);
  const spouseNeedOf = (r: LiChart["rows"][number]) => (married ? (r.spouseNeed ?? 0) : 0);
  // Bars stack client + spouse need, so the coverage line compares combined coverage.
  const coverageLine = chart.clientCoverageLine + (married ? (chart.spouseCoverageLine ?? 0) : 0);
  const maxNeed = Math.max(
    1,
    ...chart.rows.map((r) => r.clientNeed + spouseNeedOf(r)),
    coverageLine,
  );
  // Round the domain up to a tidy $250k tick.
  const top = Math.ceil(maxNeed / 250_000) * 250_000;

  const x = scaleBand<number>().domain(years).range([0, innerW]).padding(0.25);

  return {
    innerW,
    innerH,
    years,
    spouseNeedOf,
    coverageLine,
    x,
    y: scaleLinear().domain([0, top]).range([innerH, 0]),
    band: x.bandwidth(),
    ticks: [0, top * 0.25, top * 0.5, top * 0.75, top],
    // Show at most ~8 x labels.
    labelStep: Math.max(1, Math.ceil(years.length / 8)),
  };
}

export function LiNeedChartPdf({ chart, married }: { chart: LiChart; married: boolean }) {
  if (chart.rows.length === 0) {
    return (
      <View>
        <SvgText style={{ fontFamily: "Inter", fontSize: 8, fill: T.ink3 }}>—</SvgText>
      </View>
    );
  }
  const { innerW, innerH, years, spouseNeedOf, coverageLine, x, y, band, ticks, labelStep }
    = liChartGeom(chart, married);

  return (
    <View>
      <Svg width={W} height={H}>
        <G transform={`translate(${M.left}, ${M.top})`}>
          {ticks.map((t) => (
            <Line key={`g${t}`} x1={0} x2={innerW} y1={y(t)} y2={y(t)} stroke={T.hair} strokeWidth={0.5} />
          ))}
          {ticks.map((t) => (
            <SvgText key={`yl${t}`} x={-6} y={y(t) + 3} textAnchor="end" style={{ fontFamily: "Inter", fontSize: 6.5, fill: T.ink3 }}>
              {fmtUsd(t)}
            </SvgText>
          ))}

          {/* Need bars (client + optional spouse, stacked) */}
          {chart.rows.map((r) => {
            const cx = x(r.year);
            if (cx == null) return null;
            const isMark = r.year === chart.markYear;
            const spouseNeed = spouseNeedOf(r);
            const clientTop = y(r.clientNeed);
            const stackTop = y(r.clientNeed + spouseNeed);
            // Hairline gap at the segment junction so the two needs read separately.
            const junctionGap = spouseNeed > 0 && r.clientNeed > 0 ? 0.75 : 0;
            const spouseH = Math.max(0, clientTop - stackTop - junctionGap);
            return (
              <G key={`b${r.year}`}>
                <Rect
                  x={cx}
                  y={clientTop}
                  width={band}
                  height={innerH - clientTop}
                  fill={isMark ? T.accent : T.steel}
                />
                {spouseH > 0 ? (
                  <Rect
                    x={cx}
                    y={stackTop}
                    width={band}
                    height={spouseH}
                    fill={isMark ? T.accentMuted : T.ink3}
                  />
                ) : null}
              </G>
            );
          })}

          {/* Current-coverage reference line (combined when married) */}
          <Line
            x1={0}
            x2={innerW}
            y1={y(coverageLine)}
            y2={y(coverageLine)}
            stroke={T.crit}
            strokeWidth={1}
            strokeDasharray="3 3"
          />

          {/* MC solve marker at the death year */}
          {chart.markYear != null && x(chart.markYear) != null
            ? (() => {
                const row = chart.rows.find((r) => r.year === chart.markYear);
                if (!row) return null;
                const cx = (x(chart.markYear) ?? 0) + band / 2;
                return (
                  <Circle cx={cx} cy={y(row.clientNeed + spouseNeedOf(row))} r={3.5} fill={T.accent} stroke="#ffffff" strokeWidth={1.2} />
                );
              })()
            : null}

          {/* X labels — centred with `textAnchor`, the way the y ticks above are
              anchored. @react-pdf ignores `textAlign` on an SvgText outright, so
              the `textAlign: "center"` this used to carry did nothing: the years
              kept SVG's default `start` and ran right from the bar's midpoint,
              landing half a label — most of a band — past the bar they name. */}
          {years.map((yr, i) =>
            i % labelStep === 0 ? (
              <SvgText
                key={`xl${yr}`}
                x={(x(yr) ?? 0) + band / 2}
                y={innerH + 12}
                textAnchor="middle"
                style={{ fontFamily: "Inter", fontSize: 6.5, fill: T.ink3 }}
              >
                {String(yr)}
              </SvgText>
            ) : null,
          )}
        </G>
      </Svg>
    </View>
  );
}
