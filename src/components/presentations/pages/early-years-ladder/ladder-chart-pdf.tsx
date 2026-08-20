import { View, Svg, G, Rect, Line, Text as SvgText, Text } from "@react-pdf/renderer";
import { PRESENTATION_THEME as T } from "@/lib/presentations/theme";
import { dataLight } from "@/brand";
import { fmtAxisUsd, MONO } from "../retirement-comparison/chart-axis";
import type { LadderGroup } from "@/lib/presentations/pages/early-years-ladder/types";

// The plan as it stands is grey; every raised rung is green, deepening toward
// the top of the ladder. Fixed hexes rather than opacity — a printed PDF's
// alpha blend against cream paper is not the same colour on every printer.
const CURRENT = dataLight.grey;
const RAISED = ["#8ecdb0", "#4aad80", dataLight.green];

/** Colours for the raised rungs, always ending on the full green so the top of
 *  the ladder reads the same whether the advisor set one extra rung or three. */
function raisedFills(count: number): string[] {
  return RAISED.slice(Math.max(0, RAISED.length - count));
}

interface Props {
  groups: LadderGroup[];
  width?: number;
}

/** Grouped bars: one cluster per milestone age, one bar per rung. */
export function LadderChartPdf({ groups, width = 355 }: Props) {
  if (groups.length === 0) return null;

  const height = 178;
  const padL = 2, padR = 2, padT = 16, padB = 20;
  const plotH = height - padT - padB;
  // Headroom so the value label above the tallest bar is not clipped.
  const barsH = plotH - 10;
  const baseY = padT + plotH;

  const maxY = Math.max(1, ...groups.flatMap((g) => g.bars.map((b) => b.value)));
  const barCount = groups[0].bars.length;
  const slot = (width - padL - padR) / groups.length;
  const gap = 2;
  const barW = Math.max(2, Math.min(22, (slot * 0.72 - gap * (barCount - 1)) / barCount));
  const clusterW = barCount * barW + (barCount - 1) * gap;

  const legend = groups[0].bars;
  const fills = raisedFills(legend.filter((b) => !b.isCurrent).length);
  const barFills = legend.map((b, i) =>
    b.isCurrent
      ? CURRENT
      : (fills[legend.slice(0, i).filter((x) => !x.isCurrent).length] ?? dataLight.green),
  );

  return (
    <View>
      <Svg width={width} height={height}>
        <SvgText x={padL} y={padT - 6} textAnchor="start" style={{ fontSize: 6, fill: T.ink3 }}>
          portfolio · today&apos;s dollars
        </SvgText>

        {groups.map((g, gi) => {
          const clusterX = padL + gi * slot + (slot - clusterW) / 2;
          return (
            <G key={g.age}>
              {g.bars.map((b, bi) => {
                const h = Math.max(0.5, (b.value / maxY) * barsH);
                const x = clusterX + bi * (barW + gap);
                return (
                  <G key={bi}>
                    <Rect x={x} y={baseY - h} width={barW} height={h} fill={barFills[bi]} />
                    <SvgText
                      x={x + barW / 2}
                      y={baseY - h - 3}
                      textAnchor="middle"
                      style={{ fontSize: 5.5, fill: T.ink2, fontFamily: MONO }}
                    >
                      {fmtAxisUsd(b.value)}
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
                {`Age ${g.age}`}
              </SvgText>
            </G>
          );
        })}

        <Line x1={padL} y1={baseY} x2={width - padR} y2={baseY} stroke={T.hair} strokeWidth={0.5} />
      </Svg>

      <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: 2 }}>
        {legend.map((b, i) => (
          <View
            key={i}
            style={{ flexDirection: "row", alignItems: "center", marginRight: 10, marginBottom: 2 }}
          >
            <View style={{ width: 6, height: 6, backgroundColor: barFills[i], marginRight: 3 }} />
            <Text style={{ fontSize: 7, color: T.ink2 }}>
              {b.isCurrent ? `${b.label} (today)` : b.label}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
