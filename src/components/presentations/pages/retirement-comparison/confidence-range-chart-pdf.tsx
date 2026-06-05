import { View, Svg, Path, Line, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import type { ConfidencePoint } from "@/lib/presentations/pages/retirement-comparison/types";

const PROPOSED = dataLight.green;
const CURRENT = dataLight.grey;

/** p20–p80 bands + p50 lines per plan. Proposed (green) over current (grey). */
export function ConfidenceRangeChartPdf({ points }: { points: ConfidencePoint[] }) {
  const width = 500, height = 150, padL = 6, padB = 16;
  const plotH = height - padB;
  if (points.length === 0) return null;
  const maxY = Math.max(
    1, ...points.map((p) => Math.max(p.baseP80, p.scnP80)),
  );
  const n = points.length;
  const x = (i: number) => padL + (i / Math.max(1, n - 1)) * (width - padL);
  const y = (v: number) => plotH - (Math.max(0, v) / maxY) * plotH;

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

  return (
    <View>
      <Svg width={width} height={height}>
        <Path d={band((p) => p.baseP20, (p) => p.baseP80)} fill={CURRENT} fillOpacity={0.25} />
        <Path d={band((p) => p.scnP20, (p) => p.scnP80)} fill={PROPOSED} fillOpacity={0.30} />
        <Path d={median((p) => p.baseP50)} stroke={CURRENT} strokeWidth={1.25} strokeDasharray="4 3" fill="none" />
        <Path d={median((p) => p.scnP50)} stroke={PROPOSED} strokeWidth={1.75} fill="none" />
        <Line x1={padL} y1={plotH} x2={width} y2={plotH} stroke={T.hair} strokeWidth={0.5} />
      </Svg>
      <View style={{ flexDirection: "row", marginTop: 4 }}>
        {[["Proposed range", PROPOSED], ["Current range", CURRENT]].map(([lbl, c]) => (
          <View key={lbl as string} style={{ flexDirection: "row", alignItems: "center", marginRight: 10 }}>
            <View style={{ width: 6, height: 6, backgroundColor: c as string, marginRight: 3 }} />
            <Text style={{ fontSize: 7, color: T.ink2 }}>{lbl}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
