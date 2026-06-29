import { Svg, Path, Line, Text as SvgText } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import { fmtAxisUsd, MONO } from "./chart-axis";
import type { MaxSpendPoint } from "@/lib/presentations/pages/retirement-comparison/types";

const CURRENT = dataLight.grey;   // current plan
const PROPOSED = dataLight.green; // proposed plan

/** Two max-spend lines (current vs proposed) in future dollars, with the
 *  spendable amount labeled at both ends of each line. */
export function MaxSpendChartPdf({ series, width = 500 }: { series: MaxSpendPoint[]; width?: number }) {
  const height = 124, padL = 6, padR = 48, padT = 14, padB = 16;
  const plotH = height - padT - padB;
  if (series.length === 0) return null;
  const maxY = Math.max(1, ...series.map((p) => Math.max(p.base, p.scenario)));
  const n = series.length;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (width - padL - padR);
  const y = (v: number) => padT + plotH - (v / maxY) * plotH;
  const toPath = (sel: (p: MaxSpendPoint) => number) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(" ");

  const first = series[0], last = series[n - 1];
  const endLabel = (v: number, color: string) => (
    <SvgText x={x(n - 1) + 4} y={y(v) + 2.5} textAnchor="start" style={{ fontSize: 7, fontWeight: 600, fill: color, fontFamily: MONO }}>
      {fmtAxisUsd(v)}
    </SvgText>
  );

  return (
    <Svg width={width} height={height}>
      <SvgText x={padL} y={padT - 5} textAnchor="start" style={{ fontSize: 6, fill: T.ink3 }}>$/yr · future dollars</SvgText>

        <Path d={toPath((p) => p.base)} stroke={CURRENT} strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
        <Path d={toPath((p) => p.scenario)} stroke={PROPOSED} strokeWidth={2} fill="none" />
        <Line x1={padL} y1={padT + plotH} x2={width - padR} y2={padT + plotH} stroke={T.hair} strokeWidth={0.5} />

        {/* start-value labels (above each point) */}
        <SvgText x={x(0)} y={y(first.scenario) - 4} textAnchor="start" style={{ fontSize: 6.5, fill: PROPOSED, fontFamily: MONO }}>{fmtAxisUsd(first.scenario)}</SvgText>
        <SvgText x={x(0)} y={y(first.base) + 9} textAnchor="start" style={{ fontSize: 6.5, fill: CURRENT, fontFamily: MONO }}>{fmtAxisUsd(first.base)}</SvgText>

        {/* end-value labels (to the right of each endpoint) */}
        {endLabel(last.scenario, PROPOSED)}
        {endLabel(last.base, CURRENT)}

        {/* year ticks */}
        {[0, n - 1].map((i) => (
          <SvgText key={i} x={x(i)} y={padT + plotH + 11} textAnchor={i === 0 ? "start" : "end"} style={{ fontSize: 6, fill: T.ink3, fontFamily: MONO }}>
            {`'${String(series[i].year).slice(2)}`}
          </SvgText>
        ))}
    </Svg>
  );
}
