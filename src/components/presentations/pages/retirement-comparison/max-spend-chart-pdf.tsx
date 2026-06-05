import { View, Svg, Path, Line, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import type { MaxSpendPoint } from "@/lib/presentations/pages/retirement-comparison/types";

const CURRENT = dataLight.grey;  // current plan
const PROPOSED = dataLight.green; // proposed plan (teal/green)

/** Two inflated max-spend lines, current (grey) vs proposed (green). */
export function MaxSpendChartPdf({ series }: { series: MaxSpendPoint[] }) {
  const width = 500, height = 112, padL = 6, padB = 16;
  const plotH = height - padB;
  if (series.length === 0) return null;
  const maxY = Math.max(1, ...series.map((p) => Math.max(p.base, p.scenario)));
  const n = series.length;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (width - padL);
  const y = (v: number) => plotH - (v / maxY) * plotH;
  const toPath = (sel: (p: MaxSpendPoint) => number) =>
    series.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(sel(p)).toFixed(1)}`).join(" ");

  return (
    <View>
      <Svg width={width} height={height}>
        <Path d={toPath((p) => p.base)} stroke={CURRENT} strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
        <Path d={toPath((p) => p.scenario)} stroke={PROPOSED} strokeWidth={2} fill="none" />
        <Line x1={padL} y1={plotH} x2={width} y2={plotH} stroke={T.hair} strokeWidth={0.5} />
        {[0, n - 1].map((i) => (
          <SvgText key={i} x={x(i)} y={plotH + 11} textAnchor={i === 0 ? "start" : "end"} style={{ fontSize: 6, fill: T.ink2 }}>
            {`'${String(series[i].year).slice(2)}`}
          </SvgText>
        ))}
      </Svg>
      <View style={{ flexDirection: "row", marginTop: 4 }}>
        {[["Proposed", PROPOSED], ["Current", CURRENT]].map(([lbl, c]) => (
          <View key={lbl as string} style={{ flexDirection: "row", alignItems: "center", marginRight: 10 }}>
            <View style={{ width: 6, height: 6, backgroundColor: c as string, marginRight: 3 }} />
            <Text style={{ fontSize: 7, color: T.ink2 }}>{lbl}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
