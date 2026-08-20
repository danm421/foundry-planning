import { View, Svg, G, Rect, Line, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { fmtAxisUsd, MONO } from "../pages/retirement-comparison/chart-axis";

export interface GroupedBarSeries {
  /** Legend text, printed EXACTLY as given — a page that wants "(today)" adds
   *  it. Colour meaning belongs to the page, not to the chart: the ladder
   *  deepens toward the top rung while the cost-of-waiting page pales toward the
   *  longest delay, and neither ordering is the chart's to know. */
  label: string;
  fill: string;
}

export interface GroupedBarGroup {
  /** Cluster label under the axis — "Age 40". */
  label: string;
  /** One value per series, in series order. */
  values: number[];
}

interface Props {
  series: GroupedBarSeries[];
  groups: GroupedBarGroup[];
  /** Small note above the plot saying what the bars measure. */
  caption: string;
  width?: number;
}

/** Grouped bars: one cluster per group, one bar per series. */
export function GroupedBarChartPdf({ series, groups, caption, width = 355 }: Props) {
  if (groups.length === 0 || series.length === 0) return null;

  const height = 178;
  const padL = 2, padR = 2, padT = 16, padB = 20;
  const plotH = height - padT - padB;
  // Headroom so the value label above the tallest bar is not clipped.
  const barsH = plotH - 10;
  const baseY = padT + plotH;

  const maxY = Math.max(1, ...groups.flatMap((g) => g.values));
  const barCount = series.length;
  const slot = (width - padL - padR) / groups.length;
  const gap = 2;
  const barW = Math.max(2, Math.min(22, (slot * 0.72 - gap * (barCount - 1)) / barCount));
  const clusterW = barCount * barW + (barCount - 1) * gap;

  return (
    <View>
      <Svg width={width} height={height}>
        <SvgText x={padL} y={padT - 6} textAnchor="start" style={{ fontSize: 6, fill: T.ink3 }}>
          {caption}
        </SvgText>

        {groups.map((g, gi) => {
          const clusterX = padL + gi * slot + (slot - clusterW) / 2;
          return (
            <G key={g.label}>
              {g.values.map((v, bi) => {
                const h = Math.max(0.5, (v / maxY) * barsH);
                const x = clusterX + bi * (barW + gap);
                return (
                  <G key={bi}>
                    <Rect x={x} y={baseY - h} width={barW} height={h} fill={series[bi].fill} />
                    <SvgText
                      x={x + barW / 2}
                      y={baseY - h - 3}
                      textAnchor="middle"
                      style={{ fontSize: 5.5, fill: T.ink2, fontFamily: MONO }}
                    >
                      {fmtAxisUsd(v)}
                    </SvgText>
                  </G>
                );
              })}
              <SvgText
                x={clusterX + clusterW / 2}
                y={baseY + 12}
                textAnchor="middle"
                style={{ fontSize: 7, fill: T.ink2 }}
              >
                {g.label}
              </SvgText>
            </G>
          );
        })}

        <Line x1={padL} y1={baseY} x2={width - padR} y2={baseY} stroke={T.hair} strokeWidth={0.5} />
      </Svg>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 2 }}>
        {series.map((sr, i) => (
          <View
            key={i}
            style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}
          >
            <View style={{ width: 6, height: 6, backgroundColor: sr.fill, marginRight: 3 }} />
            <Text style={{ fontSize: 7, color: T.ink2 }}>{sr.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
