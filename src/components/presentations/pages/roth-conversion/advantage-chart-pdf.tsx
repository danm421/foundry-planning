import { View, Svg, Line, Polygon, Polyline, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { signed } from "@/lib/presentations/format";
import { fmtAxisUsd, MONO } from "../retirement-comparison/chart-axis";
import { CONVERTED_FILL, TAX_FILL } from "./conversion-chart-pdf";
import type { RothBreakeven } from "@/lib/presentations/pages/roth-conversion/types";

/**
 * How much more (or less) the heirs would receive with the conversions, year by
 * year. Above the zero line the family is ahead; the shading changes color where
 * the line crosses it, and the break-even year is marked and labelled — the
 * crossing is the point of the chart, so it must not depend on color to read.
 */
export function AdvantageChartPdf({
  points,
  breakeven,
  width,
  height = 128,
}: {
  points: Array<{ year: number; value: number }>;
  breakeven: RothBreakeven | null;
  width: number;
  height?: number;
}) {
  if (points.length < 2) return null;
  const padL = 36, padR = 8, padT = 12, padB = 14;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const values = points.map((p) => p.value);
  const hi = Math.max(0, ...values);
  const lo = Math.min(0, ...values);
  const span = hi - lo || 1;
  const yOf = (v: number) => padT + ((hi - v) / span) * plotH;
  const xOf = (i: number) => padL + (i / (points.length - 1)) * plotW;
  const y0 = yOf(0);

  // Insert the exact zero crossing between two points of opposite sign, so the
  // two shaded areas meet on the line instead of on a slanted edge.
  const path: Array<{ x: number; v: number }> = [];
  points.forEach((p, i) => {
    path.push({ x: xOf(i), v: p.value });
    const next = points[i + 1];
    if (next && p.value * next.value < 0) {
      const t = p.value / (p.value - next.value);
      path.push({ x: xOf(i) + t * (xOf(i + 1) - xOf(i)), v: 0 });
    }
  });
  const area = (clamp: (v: number) => number) =>
    [
      `${path[0].x.toFixed(1)},${y0.toFixed(1)}`,
      ...path.map((p) => `${p.x.toFixed(1)},${yOf(clamp(p.v)).toFixed(1)}`),
      `${path[path.length - 1].x.toFixed(1)},${y0.toFixed(1)}`,
    ].join(" ");
  const line = points.map((p, i) => `${xOf(i).toFixed(1)},${yOf(p.value).toFixed(1)}`).join(" ");

  const beYear = breakeven?.kind === "year" ? breakeven.year : null;
  const beIndex = beYear != null ? points.findIndex((p) => p.year === beYear) : -1;
  const beX = beIndex >= 0 ? xOf(beIndex) : null;
  // A label in the right third would run off the plot; anchor it to its end.
  const beAnchor = beX != null && beX > padL + plotW * 0.66 ? "end" : "start";
  const yearLabels = [0, points.length - 1];

  return (
    <View>
      <Svg width={width} height={height}>
        {hi > 0 ? <Polygon points={area((v) => Math.max(0, v))} fill={CONVERTED_FILL} fillOpacity={0.16} /> : null}
        {lo < 0 ? <Polygon points={area((v) => Math.min(0, v))} fill={TAX_FILL} fillOpacity={0.18} /> : null}
        <Line x1={padL} y1={y0} x2={padL + plotW} y2={y0} stroke={T.ink3} strokeWidth={0.75} />
        <Polyline points={line} fill="none" stroke={T.ink} strokeWidth={1.25} />

        {/* Zero always prints; an extreme prints only when it clears zero's
            label, or the two overprint ("$0" on "−$20K"). */}
        {[0, ...[hi, lo].filter((v) => Math.abs(v) >= 1 && Math.abs(yOf(v) - y0) >= 9)].map((v) => (
          <SvgText
            key={v}
            x={padL - 4}
            y={yOf(v) + 2}
            textAnchor="end"
            style={{ fontSize: 6.5, fill: T.ink2, fontFamily: MONO }}
          >
            {signed(v, fmtAxisUsd)}
          </SvgText>
        ))}

        {beX != null ? (
          <>
            <Line x1={beX} y1={padT - 4} x2={beX} y2={padT + plotH} stroke={T.ink2} strokeWidth={0.75} strokeDasharray="2 2" />
            <SvgText
              x={beAnchor === "start" ? beX + 3 : beX - 3}
              y={padT - 2}
              textAnchor={beAnchor}
              style={{ fontSize: 7, fill: T.ink, fontWeight: 700 }}
            >
              {`Break-even ${beYear}`}
            </SvgText>
          </>
        ) : null}

        {yearLabels.map((i) => (
          <SvgText
            key={i}
            x={xOf(i)}
            y={height - 3}
            textAnchor={i === 0 ? "start" : "end"}
            style={{ fontSize: 7, fill: T.ink2, fontFamily: MONO }}
          >
            {String(points[i].year)}
          </SvgText>
        ))}
      </Svg>
      <Text style={{ fontSize: 7, color: T.ink3, marginTop: 2 }}>
        Above the line, your heirs come out ahead with the conversions.
      </Text>
    </View>
  );
}
