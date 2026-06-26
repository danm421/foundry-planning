import { View, Svg, Path, Line, Text as SvgText } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import { fmtAxisUsd, MONO } from "./chart-axis";
import { ChartLegend } from "./chart-legend-pdf";
import type { ConfidencePoint } from "@/lib/presentations/pages/retirement-comparison/types";

const PROPOSED = dataLight.green;
const CURRENT = dataLight.grey;

/** p20–p80 bands + p50 lines per plan, with year ticks and end-of-plan value
 *  labels (both medians + the proposed downside floor). Proposed over current. */
export function ConfidenceRangeChartPdf({ points, width = 500 }: { points: ConfidencePoint[]; width?: number }) {
  const height = 124, padL = 6, padR = 50, padT = 12, padB = 16;
  const plotH = height - padT - padB;
  if (points.length === 0) return null;
  const maxY = Math.max(1, ...points.map((p) => Math.max(p.baseP80, p.scnP80)));
  const n = points.length;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (width - padL - padR);
  const y = (v: number) => padT + plotH - (Math.max(0, v) / maxY) * plotH;

  // Band path = top edge (p80) left→right then bottom edge (p20) right→left, closed.
  const band = (lo: (p: ConfidencePoint) => number, hi: (p: ConfidencePoint) => number) => {
    const top = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(hi(p)).toFixed(1)}`).join(" ");
    const bot = points.slice().reverse().map((p, j) => {
      const i = n - 1 - j;
      return `L${x(i).toFixed(1)},${y(lo(p)).toFixed(1)}`;
    }).join(" ");
    return `${top} ${bot} Z`;
  };
  const median = (sel: (p: ConfidencePoint) => number) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(" ");

  const last = points[n - 1];

  return (
    <View>
      <Svg width={width} height={height}>
        <Path d={band((p) => p.baseP20, (p) => p.baseP80)} fill={CURRENT} fillOpacity={0.25} />
        <Path d={band((p) => p.scnP20, (p) => p.scnP80)} fill={PROPOSED} fillOpacity={0.30} />
        <Path d={median((p) => p.baseP50)} stroke={CURRENT} strokeWidth={1.25} strokeDasharray="4 3" fill="none" />
        <Path d={median((p) => p.scnP50)} stroke={PROPOSED} strokeWidth={1.75} fill="none" />
        <Line x1={padL} y1={padT + plotH} x2={width - padR} y2={padT + plotH} stroke={T.hair} strokeWidth={0.5} />

        {/* end-of-plan value labels: proposed median, proposed downside (p20), current median */}
        <SvgText x={x(n - 1) + 4} y={y(last.scnP50) + 2.5} textAnchor="start" style={{ fontSize: 7, fontWeight: 600, fill: PROPOSED, fontFamily: MONO }}>{fmtAxisUsd(last.scnP50)}</SvgText>
        <SvgText x={x(n - 1) + 4} y={y(last.scnP20) + 2.5} textAnchor="start" style={{ fontSize: 6.5, fill: PROPOSED, fontFamily: MONO }}>{fmtAxisUsd(last.scnP20)}</SvgText>
        <SvgText x={x(n - 1) + 4} y={y(last.baseP50) + 2.5} textAnchor="start" style={{ fontSize: 6.5, fill: T.ink3, fontFamily: MONO }}>{fmtAxisUsd(last.baseP50)}</SvgText>

        {/* year ticks */}
        {[0, n - 1].map((i) => (
          <SvgText key={i} x={x(i)} y={padT + plotH + 11} textAnchor={i === 0 ? "start" : "end"} style={{ fontSize: 6, fill: T.ink3, fontFamily: MONO }}>
            {`'${String(points[i].year).slice(2)}`}
          </SvgText>
        ))}
      </Svg>
      <ChartLegend items={[{ label: "Proposed range (p20–p80)", color: PROPOSED }, { label: "Current range", color: CURRENT }]} />
    </View>
  );
}
